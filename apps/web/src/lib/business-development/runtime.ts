import { Pool } from "pg";
import { isolatedDatabaseUrl } from "./policy.ts";
import { BusinessDirector } from "./queue.ts";

const globalDirector = globalThis as unknown as { businessDirector?: BusinessDirector };
export function getBusinessDirector() {
  if (process.env.BG_V2_ENABLED !== "true") throw new Error("CONTROL_PLANE_DISABLED");
  const connectionString = isolatedDatabaseUrl(process.env.BG_V2_DATABASE_URL);
  if (!globalDirector.businessDirector) {
    const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 });
    // Prevent unhandled background pool errors without logging credentials/DB payloads.
    pool.on("error", () => {});
    globalDirector.businessDirector = new BusinessDirector(pool);
  }
  return globalDirector.businessDirector;
}
