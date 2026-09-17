import { startCodexContentBridge } from "./codex-content-bridge.js";

void startCodexContentBridge().catch((error) => {
  console.error("[codex-content-bridge]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
