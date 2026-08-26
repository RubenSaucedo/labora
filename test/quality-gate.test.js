import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQualityGate } from "../src/lib/quality-gate.js";
import { ZReleaseOutput } from "../src/schemas/release-output.js";
import { approvalStatus } from "../src/lib/release-state.js";

function passingInputs() {
  const artifactHash = "a".repeat(64);
  const metadata = {
    rubricVersion: "test",
    model: "test-model",
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
    atsResults: {
      best: {
        ats: {
          hard_eligibility_missing: [],
          core_requirements_missing: [],
          requirement_coverage_percent: 100,
        },
      },
    },
    atsJudge: { metadata, score: 90, verdict: "pass" },
    engineerJudge: { metadata, score: 90, verdict: "advance_to_onsite" },
    hrJudge: {
      metadata,
      score: 80,
      screenRecommendation: "advance",
      visualReview: { reviewed: true, pageCount: 1, concerns: [] },
    },
    expectedJudgeMetadata: { ats: metadata, engineer: metadata, hr: metadata },
  };
}

const codes = (result) => result.findings.map((finding) => finding.code);

test("a clean run is review_ready, and is never approved by the tool", () => {
  const result = evaluateQualityGate(passingInputs());
  assert.equal(result.state, "review_ready");
  assert.deepEqual(result.findings, []);
  // The absence of any path to `send_ready` is the point of the change.
  assert.notEqual(result.state, "send_ready");
  assert.notEqual(result.state, "operator_approved");
});

test("the only non-review state is a missing artifact, and it is not a veto", () => {
  const input = passingInputs();
  input.artifactHash = null;
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "generation_failed");
});

test("a judge that says no reports an estimate and does not stop anything", () => {
  const input = passingInputs();
  input.engineerJudge.score = 20;
  input.engineerJudge.verdict = "no";
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "review_ready");
  const outlook = result.findings.find((f) => f.source === "judge_engineer" && f.code === "weak_outlook");
  assert.ok(outlook, "the verdict is still reported");
  assert.equal(outlook.status, "uncertain");
  assert.match(outlook.finding, /not a fact about the candidate/);
});

test("an ATS fail and a recruiter decline are estimates too", () => {
  const input = passingInputs();
  input.atsJudge.score = 10;
  input.atsJudge.verdict = "fail";
  input.hrJudge.score = 10;
  input.hrJudge.screenRecommendation = "decline";
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "review_ready");
  assert.ok(result.findings.every((f) => f.status !== "unsupported"));
});

test("uncovered hard eligibility is reported as a fact about the document, not the person", () => {
  const input = passingInputs();
  input.atsResults.best.ats.hard_eligibility_missing = ["A stated categorical requirement"];
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "review_ready");
  const finding = result.findings.find((f) => f.code === "hard_eligibility_not_covered");
  assert.match(finding.finding, /says nothing about whether the requirement is met/);
  // Recorded as evidence, but evidence that no longer stops anyone.
  assert.equal(result.gates.requirements, false);
});

test("an unsupported claim is reported, offered a route, and still rendered", () => {
  const input = passingInputs();
  input.claimValidation = {
    valid: false,
    issues: [{ severity: "error", code: "claim_unsupported", message: "Leadership wording was not established.", location: "bullets[2]" }],
  };
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "review_ready");
  const finding = result.findings.find((f) => f.code === "claim_unsupported");
  assert.equal(finding.status, "unsupported");
  assert.deepEqual(finding.basis, ["bullets[2]"]);
  assert.ok(finding.suggestedActions.includes("Accept the finding and continue"));
  assert.ok(finding.suggestedActions.includes("Use narrower wording"));
});

test("a stale derived record is uncertain, never unsupported", () => {
  const input = passingInputs();
  input.claimValidation = {
    valid: false,
    issues: [{
      severity: "error",
      code: "claim_source_mismatch",
      class: "stale_derived_record",
      message: "The ledger describes an earlier version of its source.",
      location: "claim-4",
    }],
  };
  const finding = evaluateQualityGate(input).findings.find((f) => f.code === "claim_source_mismatch");
  // Bookkeeping lag is not a statement about the person's history.
  assert.equal(finding.status, "uncertain");
  assert.match(finding.suggestedActions[0], /Rebuild/);
});

test("stale judge metadata is reported as describing a different document", () => {
  const input = passingInputs();
  input.atsJudge.metadata = { ...input.atsJudge.metadata, promptHash: "d".repeat(64) };
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "review_ready");
  const finding = result.findings.find((f) => f.code === "judge_metadata_stale");
  assert.match(finding.finding, /promptHash/);
  assert.equal(result.gates.atsJudge, false);
});

test("diagnostics produced for a different artifact are reported, not enforced", () => {
  const input = passingInputs();
  input.artifactValidation.artifactHash = "b".repeat(64);
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "review_ready");
  assert.ok(codes(result).includes("diagnostics_describe_other_artifact"));
  assert.equal(result.gates.artifact, false);
});

test("a missing judge is a missing perspective, not a refusal", () => {
  const input = passingInputs();
  input.engineerJudge = null;
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "review_ready");
  assert.ok(codes(result).includes("judge_absent"));
});

test("contradictory judge scores are reported as unreadable, not as a block", () => {
  const input = passingInputs();
  input.atsJudge.score = 0;
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "review_ready");
  assert.ok(codes(result).includes("score_verdict_inconsistent"));
});

test("a stale pipeline stage is reported with a rebuild route", () => {
  const input = passingInputs();
  input.pipelineErrors = ["Stale pipeline stages must be rebuilt: tailor."];
  const finding = evaluateQualityGate(input).findings.find((f) => f.code === "stale_stage");
  assert.equal(finding.status, "uncertain");
  assert.match(finding.suggestedActions[0], /Rebuild/);
});

test("no finding is ever emitted without a route out of it", () => {
  const input = passingInputs();
  input.claimValidation = { valid: false, issues: [{ severity: "error", code: "claim_unsupported", message: "x", location: "y" }] };
  input.atsResults.best.ats.hard_eligibility_missing = ["r"];
  input.atsResults.best.ats.core_requirements_missing = ["s"];
  input.engineerJudge.score = 10;
  input.engineerJudge.verdict = "no";
  input.applicationStrategy = { status: "needs_evidence" };
  input.pipelineErrors = ["stale"];
  const result = evaluateQualityGate(input);
  assert.ok(result.findings.length >= 6);
  for (const finding of result.findings) {
    assert.ok(finding.suggestedActions.length > 0, `${finding.code} has no route`);
  }
});

test("finding ids are derived from content, so an unrelated finding never renumbers another", () => {
  const first = evaluateQualityGate({
    ...passingInputs(),
    claimValidation: { valid: false, issues: [{ severity: "error", code: "claim_unsupported", message: "x", location: "bullets[2]" }] },
  });
  const target = first.findings.find((f) => f.code === "claim_unsupported").id;

  const second = evaluateQualityGate({
    ...passingInputs(),
    claimValidation: { valid: false, issues: [{ severity: "error", code: "claim_unsupported", message: "x", location: "bullets[2]" }] },
    pipelineErrors: ["an entirely unrelated stale stage"],
  });
  assert.equal(second.findings.find((f) => f.code === "claim_unsupported").id, target);
});

test("the same concern seen by two stages is acknowledged once", () => {
  const input = passingInputs();
  input.pipelineErrors = ["Stale pipeline stages must be rebuilt: tailor.", "Stale pipeline stages must be rebuilt: tailor."];
  const result = evaluateQualityGate(input);
  assert.equal(result.findings.filter((f) => f.code === "stale_stage").length, 1);
});

test("output validates against the release schema", () => {
  const input = passingInputs();
  input.claimValidation = { valid: false, issues: [{ severity: "error", code: "claim_unsupported", message: "x", location: "y" }] };
  const parsed = ZReleaseOutput.parse(evaluateQualityGate(input));
  assert.equal(parsed.schemaVersion, "2.0");
  assert.equal(parsed.findingSummary.unsupported, 1);
});

test("the schema cannot express a tool-authored approval", () => {
  const result = evaluateQualityGate(passingInputs());
  assert.throws(() => ZReleaseOutput.parse({ ...result, state: "operator_approved" }));
  assert.throws(() => ZReleaseOutput.parse({ ...result, state: "send_ready" }));
});

test("an approval stops applying when the artifact changes", () => {
  const release = evaluateQualityGate(passingInputs());
  const approval = {
    artifactHash: release.artifact.hash,
    acceptedFindingIds: release.findings.map((f) => f.id),
  };
  assert.equal(approvalStatus(release, approval).approved, true);

  const rebuilt = { ...release, artifact: { ...release.artifact, hash: "e".repeat(64) } };
  const status = approvalStatus(rebuilt, approval);
  assert.equal(status.approved, false);
  assert.match(status.reason, /artifact changed/);
});

test("an approval stops applying when a new finding appears", () => {
  const input = passingInputs();
  const release = evaluateQualityGate(input);
  const approval = {
    artifactHash: release.artifact.hash,
    acceptedFindingIds: release.findings.map((f) => f.id),
  };

  input.claimValidation = { valid: false, issues: [{ severity: "error", code: "claim_unsupported", message: "x", location: "y" }] };
  const rerun = evaluateQualityGate(input);
  const status = approvalStatus(rerun, approval);
  assert.equal(status.approved, false);
  assert.equal(status.unacknowledged.length, 1);
});
