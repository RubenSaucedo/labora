import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareJudgeInput } from "../src/lib/judge-input.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const applicationDir = path.join(
  repoRoot,
  "data",
  "personas",
  "example",
  "applications",
  "acme-senior-fe-mar-25"
);

test("prepares isolated ATS input without provenance", async () => {
  const result = await prepareJudgeInput({
    repoRoot,
    applicationDir,
    artifactPath: path.join(applicationDir, "final-resume-style-1.docx"),
    judge: "ats",
  });

  assert.equal(result.judge, "ats");
  assert.match(result.metadata.evaluatedArtifactHash, /^[a-f0-9]{64}$/);
  assert.match(result.metadata.promptHash, /^[a-f0-9]{64}$/);
  assert.match(result.metadata.inputHash, /^[a-f0-9]{64}$/);
  assert.ok(result.deterministicAts.requirements.length > 0);
  assert.equal("provenance" in result, false);
  assert.match(result.artifact.text, /Senior Frontend Engineer/);
});

test("binds HR preview pages to the selected PDF artifact", async () => {
  const result = await prepareJudgeInput({
    repoRoot,
    applicationDir,
    artifactPath: path.join(applicationDir, "final-resume-style-1.pdf"),
    judge: "hr",
  });

  assert.equal(result.visualPreview.status, "verified");
  assert.equal(result.visualPreview.pageCount, result.visualPreviewPaths.length);
  assert.ok(result.visualPreviewPaths.length > 0);
});

test("does not expose PDF previews when the selected artifact is DOCX", async () => {
  const result = await prepareJudgeInput({
    repoRoot,
    applicationDir,
    artifactPath: path.join(applicationDir, "final-resume-style-1.docx"),
    judge: "hr",
  });

  assert.equal(result.visualPreview.status, "artifact_mismatch");
  assert.deepEqual(result.visualPreviewPaths, []);
});
