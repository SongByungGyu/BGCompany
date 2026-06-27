#!/usr/bin/env node

const BASE_URL = process.env.BG_COMPANY_BASE_URL ?? "http://localhost:3000";

async function main() {
  const response = await fetch(`${BASE_URL}/api/hermes/status`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const data = await response.json();
  if (!response.ok) {
    console.error(`GET /api/hermes/status failed: ${response.status}`);
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log("BG Company Hermes Status");
  console.log(`- Runner mode: ${data.runnerMode}`);
  console.log(`- Base URL configured: ${data.configured?.baseUrl ? "yes" : "no"}`);
  console.log(`- API key configured: ${data.configured?.apiKey ? "yes" : "no"}`);
  console.log(`- Timeout: ${data.configured?.timeoutMs ?? "unknown"}ms`);
  console.log(`- Health path: ${data.configured?.healthPath ?? "/health"}`);
  console.log(`- Available: ${data.available ? "yes" : "no"}`);
  console.log(`- Message: ${data.message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
