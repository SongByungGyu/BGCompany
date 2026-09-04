import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("public and trusted pipeline entry points use separate input boundaries", () => {
  const source = fs.readFileSync(new URL("./content-pipeline-service.ts", import.meta.url), "utf8");

  assert.match(source, /startValidatedContentPipeline\(assertPublicContentPipelineInput\(input\)\)/);
  assert.match(source, /startValidatedContentPipeline\(assertTrustedContentPipelineInput\(input\)\)/);
});
