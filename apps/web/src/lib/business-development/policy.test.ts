import test from "node:test";
import assert from "node:assert/strict";
import { artifacts, isolatedDatabaseUrl, kind, label, uuid } from "./policy.ts";

test("production DB and missing URLs are rejected without revealing credentials", () => {
  for (const url of [undefined,"postgres://user:private-value@localhost/bg_company","https://example.com/bg_company_v2_test"]) {
    assert.throws(() => isolatedDatabaseUrl(url),(error: Error) => error.message === "ISOLATED_DATABASE_REQUIRED" && !error.message.includes("private-value"));
  }
  assert.equal(isolatedDatabaseUrl("postgres://localhost/bg_company_v2_staging"),"postgres://localhost/bg_company_v2_staging");
});
test("labels reject common credential strings and multiline data", () => {
  for (const value of ["",null,"hello\nworld","API_KEY=private-value","Bearer private-value","password: hidden"]) assert.throws(() => label(value));
  assert.equal(label(" BG Company 2.0 "),"BG Company 2.0");
});
test("artifact records admit only commit/path/test evidence", () => {
  assert.deepEqual(artifacts({ commitSha: "a".repeat(40),paths: ["src/app.ts"],tests: {passed: 10,failed: 0} }),
    { commitSha: "a".repeat(40),paths: ["src/app.ts"],tests: {passed: 10,failed: 0} });
  for (const path of ["../secret","/root/file","src/.env","secrets/key.json","src/key.pem","src//file","src/file.log"]) {
    assert.throws(() => artifacts({ paths: [path] }));
  }
  assert.throws(() => artifacts(JSON.parse('{"password":"hidden"}')));
  assert.throws(() => artifacts({tests: {passed: 1,failed: -1}}));
  assert.throws(() => artifacts({commitSha: "main"}));
});
test("unknown kinds and malformed IDs fail before SQL", () => {
  assert.throws(() => kind("shell"));
  assert.throws(() => uuid("1; DELETE"));
  assert.equal(kind("public_release"),"public_release");
});
