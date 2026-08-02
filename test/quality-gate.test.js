import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQualityGate } from "../src/lib/quality-gate.js";

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
    expectedJudgeMetadata: {
      ats: metadata,
      engineer: metadata,
      hr: metadata,
    },
  };
}

test("marks fully passing evidence as send ready", () => {
  assert.equal(evaluateQualityGate(passingInputs()).state, "send_ready");
});

test("blocks unsupported hard eligibility requirements", () => {
  const input = passingInputs();
  input.atsResults.best.ats.hard_eligibility_missing = ["Work authorization"];
  input.atsResults.best.ats.requirement_coverage_percent = 80;
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "blocked");
  assert.equal(result.gates.requirements, false);
});

test("routes missing core requirements to human review", () => {
  const input = passingInputs();
  input.atsResults.best.ats.core_requirements_missing = ["Required WCAG experience"];
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "human_review");
  assert.equal(result.gates.requirements, true);
  assert.equal(result.gates.coreRequirements, false);
});

test("routes uncertain judge verdicts to human review", () => {
  const input = passingInputs();
  input.hrJudge.score = 68;
  input.hrJudge.screenRecommendation = "review";
  assert.equal(evaluateQualityGate(input).state, "human_review");
});

test("blocks stale judge artifacts", () => {
  const input = passingInputs();
  input.hrJudge.metadata = {
    ...input.hrJudge.metadata,
    evaluatedArtifactHash: "b".repeat(64),
  };
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "blocked");
  assert.equal(result.gates.hrJudge, false);
});

test("blocks stale judge prompt or input hashes", () => {
  const input = passingInputs();
  input.atsJudge.metadata = {
    ...input.atsJudge.metadata,
    promptHash: "d".repeat(64),
  };
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "blocked");
  assert.equal(result.gates.atsJudge, false);
  assert.ok(result.hardBlockers.some((blocker) => /promptHash/.test(blocker)));
});

test("blocks when artifact validation targets a different delivery hash", () => {
  const input = passingInputs();
  input.artifactValidation.artifactHash = "b".repeat(64);
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "blocked");
  assert.equal(result.gates.artifact, false);
});

test("blocks contradictory judge scores and verdicts", () => {
  const input = passingInputs();
  input.atsJudge.score = 0;
  input.engineerJudge.score = 0;
  input.hrJudge.score = 0;
  const result = evaluateQualityGate(input);
  assert.equal(result.state, "blocked");
  assert.ok(result.hardBlockers.some((blocker) => /score and verdict/.test(blocker)));
});
