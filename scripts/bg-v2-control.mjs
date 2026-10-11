#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BusinessDirector } from "../apps/web/src/lib/business-development/queue.ts";
import { isolatedDatabaseUrl, ControlPlaneError } from "../apps/web/src/lib/business-development/policy.ts";

const require = createRequire(new URL("../apps/web/package.json",import.meta.url));
const { Pool } = require("pg");
let pool;
try {
  const url = isolatedDatabaseUrl(process.env.BG_V2_DATABASE_URL);
  pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 });
  const director = new BusinessDirector(pool);
  const [command,...args] = process.argv.slice(2);
  if (command === "init") {
    if (process.env.BG_V2_ALLOW_SCHEMA_CREATE !== "true") throw new ControlPlaneError("SCHEMA_CREATE_NOT_ENABLED");
    const sql = await readFile(fileURLToPath(new URL("../infrastructure/bg-company-v2/001_control_plane.sql",import.meta.url)),"utf8");
    await pool.query(sql);
    console.log(JSON.stringify({ ok: true, schemaVersion: 1 }));
  } else if (command === "status") {
    console.log(JSON.stringify(await director.status(),null,2));
  } else if (command === "start") {
    const project = await director.startProject(args[0],args[1]);
    console.log(JSON.stringify({ id: project.id,status: project.status }));
  } else if (command === "pause" || command === "resume") {
    await director.setProjectPaused(args[0],command === "pause");
    console.log(JSON.stringify({ ok: true }));
  } else {
    throw new ControlPlaneError("USE_INIT_STATUS_START_PAUSE_OR_RESUME");
  }
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof ControlPlaneError ? error.code : "CONTROL_PLANE_UNAVAILABLE" }));
  process.exitCode = 1;
} finally { if (pool) await pool.end(); }
