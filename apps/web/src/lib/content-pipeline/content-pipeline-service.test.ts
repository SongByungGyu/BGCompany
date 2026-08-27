import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("validated input preserves scheduler-supplied reference data", () => {
  const source = fs.readFileSync(new URL("./content-pipeline-service.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function assertValidInput");
  const end = source.indexOf("\nfunction channelLabel", start);
  const validator = source.slice(start, end);

  assert.match(validator, /referenceBundle = asReferenceBundle\(body\.referenceBundle\)/);
  assert.match(validator, /blogImagePrompts = asBlogImagePrompts\(body\.blogImagePrompts\)/);
  assert.match(validator, /editorialBenchmarkGuidelines = asStringArray\(body\.editorialBenchmarkGuidelines\)/);
  assert.match(validator, /referenceBundle,/);
});
