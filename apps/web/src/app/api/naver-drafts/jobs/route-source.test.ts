import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("./route.ts", import.meta.url);

test("naver draft POST accepts the scheduler agent key while GET remains admin-only", async () => {
  const source = await readFile(routeUrl, "utf8");
  const getStart = source.indexOf("export async function GET");
  const postStart = source.indexOf("export async function POST");
  const getImplementation = source.slice(getStart, postStart);
  const postImplementation = source.slice(postStart);

  assert.match(getImplementation, /requireAdminApiSession\(request\)/);
  assert.doesNotMatch(getImplementation, /verifyStockBlogSchedulerKey/);
  assert.match(postImplementation, /request\.headers\.get\("x-bg-agent-key"\)/);
  assert.match(postImplementation, /if \(!verifyStockBlogSchedulerKey\(agentKey\)\)/);
  assert.match(postImplementation, /requireAdminApiSession\(request\)/);
});
