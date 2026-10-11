#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const cwd = fileURLToPath(new URL("../apps/web",import.meta.url));
const password = randomBytes(32).toString("hex");
const base = "http://127.0.0.1:31987";
const child = spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","31987"],{
  cwd,env:{...process.env,ADMIN_PASSWORD:password,AUTH_SESSION_SECRET:randomBytes(48).toString("hex"),BG_V2_ENABLED:"false",NEXT_TELEMETRY_DISABLED:"1"},
  stdio:"ignore",shell:false,
});
child.on("error",() => {});
let check="startup";
try {
  let ready=false;
  for(let i=0;i<50;i++) {
    try { if((await fetch(base+"/api/health")).ok) {ready=true;break;} } catch {}
    if(child.exitCode!==null)break;
    await delay(100);
  }
  assert.ok(ready,"TEST_SERVER_UNAVAILABLE");
  check="anonymous-get";
  assert.equal((await fetch(base+"/api/business-development")).status,401);
  check="anonymous-post";
  assert.equal((await fetch(base+"/api/business-development",{method:"POST"})).status,401);
  check="login";
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password})});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie,"TEST_SESSION_MISSING");
  check="disabled-feature";
  const headers={cookie,origin:base,"content-type":"application/json"};
  const disabled=await fetch(base+"/api/business-development",{headers});
  assert.equal(disabled.status,503); assert.equal((await disabled.json()).error,"CONTROL_PLANE_DISABLED");
  check="cross-origin";
  assert.equal((await fetch(base+"/api/business-development",{method:"POST",headers:{...headers,origin:"https://outside.example"},body:"{}"})).status,403);
  check="body-limit";
  assert.equal((await fetch(base+"/api/business-development",{method:"POST",headers,body:"x".repeat(4097)})).status,413);
  console.log("HTTP smoke: 6 checks passed (authentication, disabled feature, origin, body limit)");
} catch {
  console.error("HTTP_SMOKE_FAILED "+check); process.exitCode=1;
} finally {
  if(child.exitCode===null) {
    const closed=once(child,"close"); child.kill("SIGTERM");
    const timer=setTimeout(() => child.kill("SIGKILL"),3000); timer.unref();
    await closed;clearTimeout(timer);
  }
}
