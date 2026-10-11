#!/usr/bin/env python3
"""Read-only VPS inventory. Never dumps env, container logs, cookies or DB rows."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone


def run(args, cwd=None, stdin=None):
    if not shutil.which(args[0]):
        return {"verified": False, "reason": "command_unavailable"}
    try:
        result = subprocess.run(args, cwd=cwd, input=stdin, capture_output=True, text=True, timeout=20)
        if result.returncode:
            return {"verified": False, "reason": "command_failed", "exit_code": result.returncode}
        return {"verified": True, "output": result.stdout.strip()}
    except (OSError, subprocess.TimeoutExpired):
        return {"verified": False, "reason": "execution_unavailable"}


def cron_metadata(text):
    jobs = []
    unknown = 0
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        matched = next((name for name in ["stock-blog-scheduler", "paper-trading-scheduler",
            "portfolio-daily-sync", "backup-postgres"] if name in line), None)
        if not matched:
            unknown += 1
            continue
        fields = line.split()
        count = 1 if fields[0].startswith("@") else 5
        schedule = " ".join(fields[:count])
        if len(fields) <= count or (count == 1 and schedule not in
                {"@reboot","@yearly","@annually","@monthly","@weekly","@daily","@hourly"}) or (
                count == 5 and not re.fullmatch(r"[\d*/?,A-Za-z -]+",schedule)):
            unknown += 1
            continue
        jobs.append({"job": matched, "schedule": schedule,
                     "command_sha256": hashlib.sha256(line.encode()).hexdigest()})
    return {"known_jobs": jobs, "other_lines_count": unknown}


def inventory(repo):
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "repo_path": str(repo),
              "scope": "this_host_only", "read_only": True}
    report["git"] = {key: run(["git", *args], cwd=repo) for key,args in {
        "head": ["rev-parse", "HEAD"], "branch": ["branch", "--show-current"],
        "status": ["status", "--porcelain"], "cached_origin_main": ["rev-parse", "origin/main"]}.items()}
    memory = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, value = line.split(":", 1)
            if key in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
                memory[key + "_kib"] = int(value.split()[0])
        disk = os.statvfs(repo)
        report["resources"] = {"verified": True, "logical_cpus": os.cpu_count(), "memory": memory,
            "disk_total_bytes": disk.f_blocks * disk.f_frsize, "disk_available_bytes": disk.f_bavail * disk.f_frsize}
    except OSError:
        report["resources"] = {"verified": False, "reason": "resource_read_unavailable"}
    containers = run(["docker", "ps", "-a", "--format", "{{.Names}}"])
    if containers["verified"]:
        names = [name for name in containers["output"].splitlines()
                 if name.startswith(("bg-company-", "hermes-agent-", "traefik-"))]
        report["containers"] = []
        fmt = '{"name":{{json .Name}},"image_id":{{json .Image}},"image_ref":{{json .Config.Image}},"status":{{json .State.Status}},"started_at":{{json .State.StartedAt}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"mounts":{{json .Mounts}},"ports":{{json .NetworkSettings.Ports}}}'
        for name in names:
            result = run(["docker", "inspect", "--format", fmt, name])
            if result["verified"]:
                try:
                    report["containers"].append(json.loads(result["output"]))
                except ValueError:
                    report["containers"].append({"name":name,"verified":False,"reason":"invalid_inventory_json"})
            else:
                report["containers"].append({"name":name,**result})
        report["docker_stats"] = run(["docker", "stats", "--no-stream", "--format",
            "{{.Name}} CPU={{.CPUPerc}} Memory={{.MemUsage}} PIDs={{.PIDs}}", *names]) if names else {"verified":True,"output":""}
        report["volumes"] = run(["docker", "volume", "ls", "--format", "{{.Name}}"])
        report["networks"] = run(["docker", "network", "ls", "--format", "{{.Name}}"])
    else:
        report["containers"] = containers
    cron = run(["crontab", "-l"])
    report["cron"] = {"verified":True,**cron_metadata(cron["output"])} if cron["verified"] else cron
    # Values are expanded inside the existing container and never echoed or passed back as arguments.
    sql = """BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT json_build_object('version', current_setting('server_version'),
 'tables', (SELECT json_agg(json_build_object('schema',n.nspname,'table',c.relname,
  'estimated_rows',c.reltuples::bigint,'bytes',pg_total_relation_size(c.oid)))
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'),
 'columns', (SELECT json_agg(json_build_object('schema',table_schema,'table',table_name,'column',column_name,'type',data_type))
  FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema')));
COMMIT;
"""
    db = run(["docker", "exec", "-i", "bg-company-postgres", "sh", "-c",
              'exec psql -X -q -t -A -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],stdin=sql)
    if db["verified"]:
        try:
            report["database"] = {"verified":True,"metadata":json.loads(db["output"]),
                                  "data_integrity":"not_proven_by_metadata_only"}
        except ValueError:
            report["database"] = {"verified":False,"reason":"invalid_database_metadata"}
    else:
        report["database"] = db
    backups = repo / "backups"
    report["backups"] = {"directory_present":backups.is_dir(),"restore_verified":False,
        "file_count":sum(1 for p in backups.iterdir() if p.is_file()) if backups.is_dir() else 0}
    report["deployment_match"] = "compare_git_head_with_container_revision;missing_revision_means_unverified"
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo",type=Path,default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    print(json.dumps(inventory(args.repo.resolve()),ensure_ascii=False,indent=2))
