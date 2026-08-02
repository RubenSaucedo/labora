import test from "node:test";
import assert from "node:assert/strict";
import { calibrateJudges } from "../src/lib/judge-calibration.js";

function meta(model, evaluatedAt) {
  return {
    rubricVersion: "1.0",
    model,
    evaluatedArtifactHash: "a".repeat(64),
    promptHash: "b".repeat(64),
    inputHash: "c".repeat(64),
    evaluatedAt,
  };
}

function ats(application, { score, verdict, model = "model-x", at = "2026-07-15T00:00:00.000Z" }) {
  return { application, judge: "ats", output: { metadata: meta(model, at), score, verdict } };
}
function engineer(application, { score, verdict, model = "model-y", at = "2026-07-15T00:00:00.000Z" }) {
  return { application, judge: "engineer", output: { metadata: meta(model, at), score, verdict } };
}
function hr(application, { score, screenRecommendation, model = "model-z", at = "2026-07-15T00:00:00.000Z" }) {
  return { application, judge: "hr", output: { metadata: meta(model, at), score, screenRecommendation } };
}

test("aggregates verdict distribution and score stats per judge", () => {
  const report = calibrateJudges([
    ats("p/a", { score: 90, verdict: "pass" }),
    ats("p/b", { score: 70, verdict: "marginal" }),
    ats("p/c", { score: 50, verdict: "fail" }),
  ]);
  assert.equal(report.judges.ats.sampleCount, 3);
  assert.deepEqual(report.judges.ats.verdictDistribution, { pass: 1, marginal: 1, fail: 1 });
  assert.equal(report.judges.ats.scoreStats.min, 50);
  assert.equal(report.judges.ats.scoreStats.max, 90);
  assert.equal(report.judges.ats.scoreStats.median, 70);
  assert.equal(report.judges.ats.scoreStats.mean, 70);
});

test("breaks scores down by model to expose grading bias", () => {
  const report = calibrateJudges([
    ats("p/a", { score: 95, verdict: "pass", model: "generous" }),
    ats("p/b", { score: 55, verdict: "fail", model: "strict" }),
    ats("p/c", { score: 45, verdict: "fail", model: "strict" }),
  ]);
  assert.equal(report.judges.ats.byModel.generous.mean, 95);
  assert.equal(report.judges.ats.byModel.strict.mean, 50);
  assert.equal(report.judges.ats.byModel.strict.count, 2);
});

test("groups results by prompt hash so rubric changes remain visible", () => {
  const report = calibrateJudges([
    ats("p/a", { score: 90, verdict: "pass" }),
    ats("p/b", { score: 70, verdict: "marginal" }),
  ]);
  assert.equal(report.judges.ats.byPromptHash["b".repeat(64)].count, 2);
  assert.equal(report.judges.ats.byPromptHash["b".repeat(64)].mean, 80);
});

test("buckets scores by month for drift", () => {
  const report = calibrateJudges([
    ats("p/a", { score: 80, verdict: "pass", at: "2026-06-01T00:00:00.000Z" }),
    ats("p/b", { score: 60, verdict: "marginal", at: "2026-07-01T00:00:00.000Z" }),
  ]);
  assert.equal(report.judges.ats.drift["2026-06"].mean, 80);
  assert.equal(report.judges.ats.drift["2026-07"].mean, 60);
});

test("computes cross-judge agreement only over complete applications", () => {
  const report = calibrateJudges([
    // unanimous positive
    ats("p/a", { score: 90, verdict: "pass" }),
    engineer("p/a", { score: 88, verdict: "advance_to_onsite" }),
    hr("p/a", { score: 85, screenRecommendation: "advance" }),
    // unanimous negative
    ats("p/b", { score: 40, verdict: "fail" }),
    engineer("p/b", { score: 45, verdict: "no" }),
    hr("p/b", { score: 42, screenRecommendation: "decline" }),
    // split
    ats("p/c", { score: 85, verdict: "pass" }),
    engineer("p/c", { score: 40, verdict: "no" }),
    hr("p/c", { score: 60, screenRecommendation: "review" }),
    // incomplete — ignored by agreement
    ats("p/d", { score: 70, verdict: "marginal" }),
  ]);
  assert.equal(report.agreement.completeApplications, 3);
  assert.equal(report.agreement.unanimousPositive, 1);
  assert.equal(report.agreement.unanimousNegative, 1);
  assert.equal(report.agreement.split, 1);
  assert.equal(report.agreement.unanimousRate, 0.67);
  assert.equal(typeof report.agreement.scoreCorrelation.ats_engineer, "number");
});

test("empty input yields zeroed, well-formed output", () => {
  const report = calibrateJudges([]);
  assert.equal(report.sampleCount, 0);
  assert.equal(report.applicationCount, 0);
  assert.equal(report.judges.hr.scoreStats.count, 0);
  assert.equal(report.judges.hr.scoreStats.mean, null);
  assert.equal(report.agreement.unanimousRate, null);
  assert.equal(report.agreement.scoreCorrelation.ats_hr, null);
});
