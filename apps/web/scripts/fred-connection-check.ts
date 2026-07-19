import { collectFredMacroData } from "../src/lib/stock-blog/references/fred-macro-provider";

async function main() {
  const result = await collectFredMacroData();
  console.log(JSON.stringify({
    ok: result.status === "ready",
    status: result.status,
    sourceCount: result.sources.length,
    missingItems: result.missingItems,
    diagnostics: result.diagnostics ?? [],
  }, null, 2));
  if (result.status !== "ready") process.exitCode = 2;
}

void main();
