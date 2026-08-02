import test from "node:test";
import assert from "node:assert/strict";
import { validateEvidenceCleaning } from "../src/lib/evidence-cleaning.js";

test("allows faithful cleanup that preserves extracted numeric facts", () => {
  const result = validateEvidenceCleaning({
    extractedText: "Reduced latency by 40 percent for 3 teams in 2025.",
    cleanedText: "Reduced latency by 40 percent for 3 teams in 2025.",
  });
  assert.equal(result.valid, true);
});

test("rejects numbers introduced during model cleaning", () => {
  const result = validateEvidenceCleaning({
    extractedText: "Reduced latency for the platform.",
    cleanedText: "Reduced latency by 40% for 3 teams.",
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.introducedNumbers.sort(), ["3 teams", "40%"]);
});

test("rejects stronger numeric qualifiers and changed units", () => {
  const stronger = validateEvidenceCleaning({
    extractedText: "Built the system over 7 years.",
    cleanedText: "Built the system over 7+ years.",
  });
  assert.equal(stronger.valid, false);
  assert.deepEqual(stronger.introducedNumbers, ["7+ years"]);

  const changedUnit = validateEvidenceCleaning({
    extractedText: "Supported 7 teams.",
    cleanedText: "Supported 7 products.",
  });
  assert.equal(changedUnit.valid, false);
  assert.deepEqual(changedUnit.introducedNumbers, ["7 products"]);
});

test("rejects stale raw or extracted evidence bindings", () => {
  const result = validateEvidenceCleaning({
    extractedText: "Reduced latency.",
    cleanedText: "Reduced latency.",
    sourceHash: "a",
    expectedSourceHash: "b",
    extractedHash: "c",
    expectedExtractedHash: "d",
    cleanedHash: "e",
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "source_hash_mismatch"));
  assert.ok(result.issues.some((issue) => issue.code === "extraction_hash_mismatch"));
});
