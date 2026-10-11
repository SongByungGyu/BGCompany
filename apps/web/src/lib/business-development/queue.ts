import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { artifacts, ControlPlaneError, ERROR_CODES, kind, label, RESTRICTED_KINDS, SAFE_KINDS, uuid } from "./policy.ts";
import type { Artifacts, ErrorCode, TaskKind } from "./policy.ts";

type Project = { id: string; request_key: string; title: string; status: string };
export type Task = { id: string; project_id: string; kind: TaskKind; status: string; dedup_key: string;
  attempt_count: number; max_attempts: number; lease_token: string | null; lease_until: Date | null };
type Outcome = { status: "succeeded" | "failed" | "interrupted" | "blocked_usage"; errorCode?: ErrorCode;
  artifacts?: Artifacts; inputTokens?: number; outputTokens?: number; actualCostMicros?: number; currency?: "USD" | "KRW" };

// Every state mutation uses the same short transaction lock. Execution never holds a DB transaction.
export class BusinessDirector {
  pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  private async tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SELECT pg_advisory_xact_lock(20261011, 2)");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async event(client: PoolClient, projectId: string, taskId: string | null, eventKind: string) {
    await client.query("INSERT INTO bg_company_v2.event(project_id,task_id,kind) VALUES ($1,$2,$3)", [projectId,taskId,eventKind]);
  }

  async startProject(requestKey: string, title: string) {
    requestKey = label(requestKey); title = label(title);
    return this.tx(async (client) => {
      const old = (await client.query<Project>("SELECT * FROM bg_company_v2.project WHERE request_key=$1", [requestKey])).rows[0];
      if (old) {
        if (old.title !== title) throw new ControlPlaneError("IDEMPOTENCY_CONFLICT");
        return old;
      }
      if ((await client.query("SELECT 1 FROM bg_company_v2.project WHERE status IN ('active','paused')")).rowCount) {
        throw new ControlPlaneError("BUSINESS_ALREADY_ACTIVE");
      }
      const project = (await client.query<Project>(
        "INSERT INTO bg_company_v2.project(id,request_key,title) VALUES ($1,$2,$3) RETURNING *",
        [randomUUID(),requestKey,title])).rows[0];
      let previous: string | null = null;
      for (const stage of SAFE_KINDS) {
        const task = await this.enqueueTx(client,project.id,stage,`initial:${stage}`,previous ? [previous] : []);
        previous = task.id;
      }
      await this.event(client,project.id,null,"project_created");
      return project;
    });
  }

  private async enqueueTx(client: PoolClient, projectId: string, taskKind: TaskKind, dedupKey: string, dependencies: string[]) {
    const project = (await client.query<Project>("SELECT * FROM bg_company_v2.project WHERE id=$1",[projectId])).rows[0];
    if (!project || project.status === "completed") throw new ControlPlaneError("PROJECT_NOT_OPEN");
    const old = (await client.query<Task>("SELECT * FROM bg_company_v2.task WHERE project_id=$1 AND dedup_key=$2",[projectId,dedupKey])).rows[0];
    if (old) {
      const existing = (await client.query<{ depends_on: string }>(
        "SELECT depends_on FROM bg_company_v2.task_dependency WHERE task_id=$1 ORDER BY depends_on",[old.id])).rows.map((r) => r.depends_on);
      if (old.kind !== taskKind || JSON.stringify(existing) !== JSON.stringify([...new Set(dependencies)].sort())) {
        throw new ControlPlaneError("IDEMPOTENCY_CONFLICT");
      }
      return old;
    }
    for (const id of new Set(dependencies)) {
      if (!(await client.query("SELECT 1 FROM bg_company_v2.task WHERE id=$1 AND project_id=$2",[id,projectId])).rowCount) {
        throw new ControlPlaneError("INVALID_DEPENDENCY");
      }
    }
    const status = (RESTRICTED_KINDS as readonly string[]).includes(taskKind) ? "awaiting_approval" : "queued";
    const task = (await client.query<Task>(
      "INSERT INTO bg_company_v2.task(id,project_id,dedup_key,kind,status) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [randomUUID(),projectId,dedupKey,taskKind,status])).rows[0];
    for (const id of new Set(dependencies)) {
      await client.query("INSERT INTO bg_company_v2.task_dependency VALUES ($1,$2)",[task.id,id]);
    }
    await this.event(client,projectId,task.id,status === "queued" ? "task_queued" : "approval_required");
    return task;
  }

  async enqueue(projectId: string, taskKind: TaskKind, dedupKey: string, dependencies: string[] = []) {
    uuid(projectId); kind(taskKind); label(dedupKey);
    if (!Array.isArray(dependencies) || dependencies.length > 20) throw new ControlPlaneError("INVALID_DEPENDENCY");
    dependencies.forEach(uuid);
    return this.tx((client) => this.enqueueTx(client,projectId,taskKind,dedupKey,dependencies));
  }

  private async recoverExpired(client: PoolClient) {
    const expired = (await client.query<Task>(
      "SELECT * FROM bg_company_v2.task WHERE status='running' AND lease_until <= clock_timestamp() FOR UPDATE")).rows;
    for (const task of expired) {
      // An expired lease does NOT prove the external process stopped. Never auto-reclaim it.
      await client.query("UPDATE bg_company_v2.attempt SET status='interrupted',ended_at=clock_timestamp(),error_code='LEASE_EXPIRED' WHERE token=$1",[task.lease_token]);
      await client.query("UPDATE bg_company_v2.task SET status='interrupted',lease_token=NULL,lease_until=NULL,error_code='LEASE_EXPIRED',updated_at=clock_timestamp() WHERE id=$1",[task.id]);
      await this.event(client,task.project_id,task.id,"lease_expired_stop_unconfirmed");
    }
  }

  async claim(workerId: string, leaseMs = 60_000): Promise<Task | null> {
    label(workerId);
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) throw new ControlPlaneError("INVALID_LEASE");
    return this.tx(async (client) => {
      await this.recoverExpired(client);
      const unsafe = await client.query("SELECT 1 FROM bg_company_v2.attempt WHERE stopped_at IS NULL LIMIT 1");
      if (unsafe.rowCount) return null;
      const gate = (await client.query<{ allowed: boolean }>(
        "SELECT (state='available' AND valid_until > clock_timestamp() AND (remaining_percent IS NULL OR remaining_percent > 20)) AS allowed FROM bg_company_v2.usage_gate WHERE id=true")).rows[0];
      if (!gate?.allowed) {
        await client.query("UPDATE bg_company_v2.task SET status='blocked_usage',updated_at=clock_timestamp() WHERE status='queued' AND project_id IN (SELECT id FROM bg_company_v2.project WHERE status='active')");
        return null;
      }
      const task = (await client.query<Task>(
        `SELECT t.* FROM bg_company_v2.task t JOIN bg_company_v2.project p ON p.id=t.project_id
         WHERE p.status='active' AND t.status='queued' AND t.not_before <= clock_timestamp() AND t.attempt_count < t.max_attempts
         AND NOT EXISTS (SELECT 1 FROM bg_company_v2.task_dependency d JOIN bg_company_v2.task prior ON prior.id=d.depends_on
                         WHERE d.task_id=t.id AND prior.status <> 'succeeded')
         ORDER BY t.created_at,t.id LIMIT 1 FOR UPDATE OF t`)).rows[0];
      if (!task) return null;
      const token = randomUUID();
      const claimed = (await client.query<Task>(
        `UPDATE bg_company_v2.task SET status='running',attempt_count=attempt_count+1,lease_token=$2,
         lease_until=clock_timestamp()+($3::int * interval '1 millisecond'),error_code=NULL,updated_at=clock_timestamp()
         WHERE id=$1 RETURNING *`,[task.id,token,leaseMs])).rows[0];
      await client.query("INSERT INTO bg_company_v2.attempt(token,task_id,worker_id,status) VALUES ($1,$2,$3,'running')",[token,task.id,workerId]);
      await this.event(client,task.project_id,task.id,"task_claimed");
      return claimed;
    });
  }

  async heartbeat(taskId: string, token: string, leaseMs = 60_000): Promise<boolean> {
    uuid(taskId); uuid(token);
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) throw new ControlPlaneError("INVALID_LEASE");
    return this.tx(async (client) => {
      const result = await client.query(
        `UPDATE bg_company_v2.task t SET lease_until=clock_timestamp()+($3::int * interval '1 millisecond'),updated_at=clock_timestamp()
         WHERE t.id=$1 AND t.lease_token=$2 AND t.status='running' AND t.lease_until > clock_timestamp()
         AND EXISTS (SELECT 1 FROM bg_company_v2.project WHERE id=t.project_id AND status='active')
         AND EXISTS (SELECT 1 FROM bg_company_v2.usage_gate WHERE state='available' AND valid_until>clock_timestamp()
                     AND (remaining_percent IS NULL OR remaining_percent>20))`,[taskId,token,leaseMs]);
      return result.rowCount === 1;
    });
  }

  // Call only AFTER the child/container has exited. Never pass live-process results here.
  async finish(taskId: string, token: string, outcome: Outcome): Promise<boolean> {
    uuid(taskId); uuid(token); artifacts(outcome.artifacts);
    if (!["succeeded","failed","interrupted","blocked_usage"].includes(outcome.status) ||
        (outcome.errorCode !== undefined && !(ERROR_CODES as readonly string[]).includes(outcome.errorCode)) ||
        [outcome.inputTokens,outcome.outputTokens,outcome.actualCostMicros].some((n) => n !== undefined && (!Number.isSafeInteger(n) || n < 0)) ||
        (outcome.actualCostMicros === undefined) !== (outcome.currency === undefined) ||
        (outcome.currency !== undefined && !["USD","KRW"].includes(outcome.currency))) throw new ControlPlaneError("INVALID_OUTCOME");
    if (outcome.status === "succeeded" && outcome.artifacts?.tests?.failed) throw new ControlPlaneError("FAILED_TESTS_CANNOT_SUCCEED");
    return this.tx(async (client) => {
      await this.recoverExpired(client);
      const task = (await client.query<Task>(
        "SELECT * FROM bg_company_v2.task WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>clock_timestamp() FOR UPDATE",[taskId,token])).rows[0];
      if (!task) return false;
      if (outcome.status === "succeeded") {
        const active = await client.query("SELECT 1 FROM bg_company_v2.project WHERE id=$1 AND status='active'",[task.project_id]);
        const gate = await client.query("SELECT 1 FROM bg_company_v2.usage_gate WHERE state='available' AND valid_until>clock_timestamp() AND (remaining_percent IS NULL OR remaining_percent>20)");
        if (!active.rowCount || !gate.rowCount) return false;
      }
      const retry = outcome.status === "failed" && task.attempt_count < task.max_attempts;
      const status = retry ? "queued" : outcome.status;
      const delayMs = retry ? Math.min(300_000,5000 * 2 ** (task.attempt_count-1)) : 0;
      await client.query(
        `UPDATE bg_company_v2.attempt SET status=$2,ended_at=clock_timestamp(),stopped_at=clock_timestamp(),error_code=$3,
         artifacts=$4,input_tokens=$5,output_tokens=$6,actual_cost_micros=$7,currency=$8 WHERE token=$1`,
        [token,outcome.status,outcome.errorCode ?? null,JSON.stringify(outcome.artifacts ?? {}),outcome.inputTokens ?? null,
          outcome.outputTokens ?? null,outcome.actualCostMicros ?? null,outcome.currency ?? null]);
      await client.query(
        `UPDATE bg_company_v2.task SET status=$2,lease_token=NULL,lease_until=NULL,error_code=$3,
         not_before=clock_timestamp()+($4::int * interval '1 millisecond'),updated_at=clock_timestamp() WHERE id=$1`,
        [taskId,status,outcome.errorCode ?? null,delayMs]);
      if (outcome.status === "blocked_usage") {
        await client.query("UPDATE bg_company_v2.usage_gate SET state='exhausted',source='quota_error',checked_at=clock_timestamp(),valid_until=NULL,remaining_percent=NULL");
        await client.query("UPDATE bg_company_v2.task SET status='blocked_usage' WHERE status='queued'");
      }
      await this.event(client,task.project_id,taskId,retry ? "retry_scheduled" : `task_${outcome.status}`);
      return true;
    });
  }

  // Fenced token lets the original worker attest exit even after its lease expired.
  async confirmStopped(token: string) {
    uuid(token);
    return this.tx(async (client) => {
      await this.recoverExpired(client);
      return (await client.query("UPDATE bg_company_v2.attempt SET stopped_at=clock_timestamp() WHERE token=$1 AND status='interrupted' AND stopped_at IS NULL",[token])).rowCount === 1;
    });
  }

  async retryInterrupted(taskId: string) {
    uuid(taskId);
    return this.tx(async (client) => {
      const task = (await client.query<Task>("SELECT * FROM bg_company_v2.task WHERE id=$1",[taskId])).rows[0];
      if (!task || task.status !== "interrupted" || task.attempt_count >= task.max_attempts) throw new ControlPlaneError("TASK_NOT_RETRYABLE");
      if ((await client.query("SELECT 1 FROM bg_company_v2.attempt WHERE task_id=$1 AND stopped_at IS NULL",[taskId])).rowCount) {
        throw new ControlPlaneError("PROCESS_STOP_UNCONFIRMED");
      }
      await client.query("UPDATE bg_company_v2.task SET status='queued',not_before=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[taskId]);
      await this.event(client,task.project_id,taskId,"interrupted_task_requeued");
    });
  }

  async setProjectPaused(projectId: string, paused: boolean) {
    uuid(projectId);
    return this.tx(async (client) => {
      const updated = await client.query("UPDATE bg_company_v2.project SET status=$2 WHERE id=$1 AND status IN ('active','paused')",[projectId,paused ? "paused" : "active"]);
      if (!updated.rowCount) throw new ControlPlaneError("PROJECT_NOT_OPEN");
      await this.event(client,projectId,null,paused ? "project_paused" : "project_resumed");
    });
  }

  // Only a separate, VERIFIED usage check may open this gate. Time passage is insufficient.
  async recordVerifiedAvailability(ttlMs: number, remainingPercent?: number) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900_000 ||
        (remainingPercent !== undefined && (!Number.isFinite(remainingPercent) || remainingPercent < 0 || remainingPercent > 100))) {
      throw new ControlPlaneError("INVALID_USAGE_OBSERVATION");
    }
    return this.tx(async (client) => {
      await client.query(`UPDATE bg_company_v2.usage_gate SET state='available',source='verified_check',checked_at=clock_timestamp(),
        valid_until=clock_timestamp()+($1::int * interval '1 millisecond'),remaining_percent=$2`,[ttlMs,remainingPercent ?? null]);
      if (remainingPercent === undefined || remainingPercent > 20) {
        await client.query("UPDATE bg_company_v2.task SET status=CASE WHEN attempt_count>=max_attempts THEN 'failed' ELSE 'queued' END,updated_at=clock_timestamp() WHERE status='blocked_usage'");
      }
    });
  }

  async completeProject(projectId: string) {
    uuid(projectId);
    return this.tx(async (client) => {
      if ((await client.query("SELECT 1 FROM bg_company_v2.task WHERE project_id=$1 AND status <> 'succeeded'",[projectId])).rowCount) {
        throw new ControlPlaneError("PROJECT_HAS_UNFINISHED_TASKS");
      }
      if (!(await client.query("UPDATE bg_company_v2.project SET status='completed' WHERE id=$1 AND status IN ('active','paused')",[projectId])).rowCount) {
        throw new ControlPlaneError("PROJECT_NOT_OPEN");
      }
      await this.event(client,projectId,null,"project_completed");
    });
  }

  async status() {
    const projects = (await this.pool.query("SELECT id,request_key,title,status,created_at FROM bg_company_v2.project ORDER BY created_at DESC LIMIT 20")).rows;
    // Lease capabilities and worker credentials are never returned to dashboard clients.
    const tasks = (await this.pool.query(`SELECT id,project_id,dedup_key,kind,status,attempt_count,max_attempts,error_code,
      not_before,updated_at FROM bg_company_v2.task ORDER BY created_at DESC LIMIT 200`)).rows;
    const usage = (await this.pool.query("SELECT state,source,checked_at,valid_until,remaining_percent FROM bg_company_v2.usage_gate")).rows[0];
    const attempts = (await this.pool.query(`SELECT task_id,status,started_at,ended_at,stopped_at,error_code,artifacts,
      input_tokens,output_tokens,actual_cost_micros,currency FROM bg_company_v2.attempt ORDER BY started_at DESC LIMIT 200`)).rows;
    return { projects,tasks,usage,attempts,executionAdapter: "not_connected",productionChangesAllowed: false };
  }
}
