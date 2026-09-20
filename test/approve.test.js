import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateQualityGate } from "../src/lib/quality-gate.js";
import { resolveReleaseState } from "../src/lib/release-state.js";

const TOOL = fileURLToPath(new URL("../src/tools/approve.js", import.meta.url));

function baseInputs(overrides = {}) {
  const artifactHash = "a".repeat(64);
  const metadata = {
    rubricVersion: "t",
    model: "m",
    evaluatedArtifactHash: artifactHash,
    promptHash: "b".repeat(64),
    inputHash: "c".repeat(64),
    evaluatedAt: "2026-07-28T00:00:00.000Z",
  };
  return {
    artifactHash,
    artifactPath: "final-resume.docx",
    artifactType: "docx",
    applicationStrategy: { status: "ready" },
    strategyValidation: { valid: true },
    claimValidation: { valid: true },
    artifactValidation: { valid: true, artifactHash },
    atsResults: { best: { ats: { hard_eligibility_missing: [], core_requirements_missing: [] } } },
    atsJudge: { metadata, score: 90, verdict: "pass" },
    engineerJudge: { metadata, score: 90, verdict: "advance_to_onsite" },
    hrJudge: { metadata, score: 80, screenRecommendation: "advance", visualReview: { reviewed: true } },
    expectedJudgeMetadata: { ats: metadata, engineer: metadata, hr: metadata },
    ...overrides,
  };
}

function application(inputs = baseInputs()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labora-approve-"));
  const release = evaluateQualityGate(inputs);
  fs.writeFileSync(path.join(dir, "release.json"), `${JSON.stringify(release, null, 2)}\n`, "utf8");
  return { dir, release };
}

function run(dir, ...args) {
  return spawnSync(process.execPath, [TOOL, dir, ...args], { encoding: "utf8" });
}

test("a clean run is not approved until a human says so", () => {
  const { dir } = application();
  assert.equal(resolveReleaseState(dir).state, "review_ready");
  assert.match(resolveReleaseState(dir).reason, /no operator approval/);
});

test("--accept-all records the decision and only then is it approved", () => {
  const { dir, release } = application();
  const result = run(dir, "--accept-all");
  assert.equal(result.status, 0, result.stderr);
  const approval = JSON.parse(fs.readFileSync(path.join(dir, "release-approval.json"), "utf8"));
  assert.equal(approval.decision, "approved_by_operator");
  assert.equal(approval.artifactHash, release.artifact.hash);
  assert.equal(resolveReleaseState(dir).state, "operator_approved");
});

test("approval is bound to the artifact, so a rebuild retracts it", () => {
  const { dir } = application();
  run(dir, "--accept-all");
  assert.equal(resolveReleaseState(dir).state, "operator_approved");

  const rebuilt = evaluateQualityGate(baseInputs({ artifactHash: "e".repeat(64) }));
  fs.writeFileSync(path.join(dir, "release.json"), `${JSON.stringify(rebuilt, null, 2)}\n`, "utf8");
  const resolved = resolveReleaseState(dir);
  assert.equal(resolved.state, "review_ready");
  assert.match(resolved.reason, /artifact changed/);
});

test("a finding that appears after approval retracts it and names itself", () => {
  const { dir } = application();
  run(dir, "--accept-all");

  const rerun = evaluateQualityGate(baseInputs({
    claimValidation: {
      valid: false,
      issues: [{ severity: "error", code: "claim_unsupported", message: "x", location: "bullets[1]" }],
    },
  }));
  fs.writeFileSync(path.join(dir, "release.json"), `${JSON.stringify(rerun, null, 2)}\n`, "utf8");
  const resolved = resolveReleaseState(dir);
  assert.equal(resolved.state, "review_ready");
  assert.equal(resolved.unacknowledged.length, 1);
  assert.match(resolved.reason, /not on screen when this was approved/);
});

test("a partial acceptance is refused as a record, not as a resume", () => {
  const { dir, release } = application(baseInputs({
    claimValidation: {
      valid: false,
      issues: [
        { severity: "error", code: "claim_unsupported", message: "x", location: "bullets[1]" },
        { severity: "error", code: "claim_unsupported", message: "y", location: "bullets[2]" },
      ],
    },
  }));
  const one = release.findings[0].id;
  const result = run(dir, "--accept", one);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unacknowledged/);
  assert.equal(fs.existsSync(path.join(dir, "release-approval.json")), false);
});

test("an unknown finding id is refused rather than recorded", () => {
  const { dir } = application();
  const result = run(dir, "--accept", "f-000000000000");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown finding id/);
});

test("there is nothing to approve when no artifact was produced", () => {
  const { dir } = application(baseInputs({ artifactHash: null }));
  const result = run(dir, "--accept-all");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not produced/);
});

test("--revoke removes the decision", () => {
  const { dir } = application();
  run(dir, "--accept-all");
  assert.equal(resolveReleaseState(dir).state, "operator_approved");
  run(dir, "--revoke");
  assert.equal(resolveReleaseState(dir).state, "review_ready");
});

test("an application with no release record is a draft, not an approval", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labora-approve-"));
  assert.equal(resolveReleaseState(dir).state, "draft");
  const result = run(dir, "--accept-all");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /quality-gate/);
});

test("the gate never writes the approval file", () => {
  const { dir } = application();
  assert.equal(fs.existsSync(path.join(dir, "release-approval.json")), false);
  // Re-running the gate over an approved application must not forge consent.
  const again = evaluateQualityGate(baseInputs());
  assert.equal("state" in again, true);
  assert.notEqual(again.state, "operator_approved");
});
