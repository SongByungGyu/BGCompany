import test from "node:test";
import assert from "node:assert/strict";
import { readControlRequest,RequestError } from "./request.ts";
function request(body: string,origin="http://localhost",contentType="application/json") {
  return new Request("http://localhost/api/business-development",{method:"POST",headers:{origin,"content-type":contentType},body});
}
test("cookie-authenticated writes require same-origin JSON",async () => {
  await assert.rejects(readControlRequest(request('{}','https://outside.example')),(e: RequestError) => e.status===403);
  await assert.rejects(readControlRequest(request('{}','http://localhost','application/jsonx')),(e: RequestError) => e.status===415);
  assert.deepEqual(await readControlRequest(request('{"action":"pause"}')),{action:"pause"});
});
test("oversized bodies are stopped at a byte limit even without Content-Length",async () => {
  await assert.rejects(readControlRequest(request('x'.repeat(4097))),(e: RequestError) => e.status===413);
  await assert.rejects(readControlRequest(request(JSON.stringify({title:'가'.repeat(1400)}))),(e: RequestError) => e.status===413);
});
test("malformed JSON and scalar/array bodies are rejected",async () => {
  for (const body of ['{','null','[]','"start"']) {
    await assert.rejects(readControlRequest(request(body)),(e: RequestError) => e.status===400);
  }
});
