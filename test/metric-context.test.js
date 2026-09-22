import test from "node:test";
import assert from "node:assert/strict";

import {
  ZMetricContext,
  detectMetrics,
  evaluateMetricContext,
  evaluateMetricContexts,
  suggestRepresentation,
} from "../src/lib/metric-context.js";
import { baselineEditorialView } from "../src/lib/editorial-baseline.js";
import { segmentResume } from "../src/lib/resume-segments.js";

import { approvedBaseline, claimLedger, withBullets } from "./fixtures/editorial.js";

/**
 * A number can be measured, attributable and completely accurate while leaving
 * a reader with the wrong picture. That is not a truth defect and claim
 * validation is right to pass it; it is an interpretation defect, and it needs
 * its own owner.
 */

function context(overrides = {}) {
  return ZMetricContext.parse({
    location: "experience[0].bullets[0]",
    claimId: "claim-catalog-latency",
    measuredObject: "catalog request completion",
    boundary: "end_to_end_path",
    latencySemantics: "full_completion",
    statistic: "p95",
    environment: "production_telemetry",
    comparator: { baseline: "", endpoint: "", relativeChange: "74%", window: "" },
    attribution: "shared_platform",
    disclosure: "public",
    readerInterpretationRisk: "material",
    representation: "relative",
    ...overrides,
  });
}

test("a measured value with no object named is reported as uninterpretable", () => {
  const issues = evaluateMetricContext({
    text: "Reduced P95 latency by 74%.",
    context: context({ measuredObject: "catalog request completion" }),
  });
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes("metric_missing_measurement_boundary"), JSON.stringify(issues, null, 2));

  const repaired = evaluateMetricContext({
    text: "Helped reduce P95 end-to-end completion latency for catalog requests by approximately 74% across a shared multi-service path.",
    context: context(),
  });
  assert.deepEqual(
    repaired.filter((issue) => issue.code === "metric_missing_measurement_boundary"),
    [],
  );
});

test("first output and full completion are distinguished when it is material", () => {
  const ambiguous = evaluateMetricContext({
    text: "Reduced catalog request latency to 11 seconds.",
    context: context({ statistic: "unspecified", representation: "absolute", comparator: { baseline: "42 seconds", endpoint: "11 seconds", relativeChange: "", window: "" } }),
  });
  assert.ok(ambiguous.some((issue) => issue.code === "latency_semantics_ambiguous"));

  // Describing first-output timing for a completion measurement is not
  // ambiguity, it is a different claim.
  const wrong = evaluateMetricContext({
    text: "Cut catalog request time to first token to 11 seconds.",
    context: context({ statistic: "unspecified", representation: "absolute" }),
  });
  const error = wrong.find((issue) => issue.code === "latency_semantics_ambiguous" && issue.severity === "error");
  assert.ok(error, JSON.stringify(wrong, null, 2));
});

test("a percentile is not allowed to flatten into an unlabelled number", () => {
  const flattened = evaluateMetricContext({
    text: "Reduced average catalog request completion latency by 74%.",
    context: context(),
  });
  assert.ok(flattened.some((issue) => issue.code === "metric_statistic_flattened"));

  // And a revision that silently drops the percentile from approved wording is
  // reported against the baseline, with `keep` as the route.
  const dropped = evaluateMetricContext({
    text: "Reduced catalog request completion latency 74%.",
    context: context({ statistic: "unspecified" }),
    baselineText: "Reduced P95 catalog request completion latency 74%.",
  });
  const regression = dropped.find((issue) => issue.code === "metric_statistic_flattened" && issue.route === "keep");
  assert.ok(regression, JSON.stringify(dropped, null, 2));
  assert.match(regression.message, /read as an average is a different claim/);
});

test("a naked percentage is not a repair for an ambiguous absolute", () => {
  const naked = evaluateMetricContext({
    text: "Improved performance by 74%.",
    context: context({ comparator: { baseline: "", endpoint: "", relativeChange: "", window: "" } }),
  });
  const issue = naked.find((entry) => entry.code === "naked_percentage_without_boundary");
  assert.ok(issue, JSON.stringify(naked, null, 2));
  assert.match(issue.message, /moves the ambiguity, it does not remove it/);
});

test("ownership wording is rejected for a shared measured path", () => {
  const inflated = evaluateMetricContext({
    text: "Led the work that cut P95 end-to-end completion latency for catalog requests by 74%.",
    context: context({ attribution: "shared_platform" }),
  });
  const issue = inflated.find((entry) => entry.code === "metric_attribution_scope_mismatch");
  assert.ok(issue);
  assert.equal(issue.severity, "error", "attribution is an evidence boundary, not a style preference");

  const honest = evaluateMetricContext({
    text: "Helped cut P95 end-to-end completion latency for catalog requests by approximately 74% across a shared multi-service path.",
    context: context({ attribution: "shared_platform" }),
  });
  assert.deepEqual(honest.filter((entry) => entry.code === "metric_attribution_scope_mismatch"), []);
});

test("benchmark and estimate measurements say so or are reported", () => {
  const silent = evaluateMetricContext({
    text: "Reduced catalog request completion latency by 74%.",
    context: context({ environment: "local_benchmark", statistic: "unspecified" }),
  });
  assert.ok(silent.some((issue) => issue.code === "metric_environment_omitted"));

  const stated = evaluateMetricContext({
    text: "Reduced catalog request completion latency by 74% in benchmark runs.",
    context: context({ environment: "local_benchmark", statistic: "unspecified" }),
  });
  assert.deepEqual(stated.filter((issue) => issue.code === "metric_environment_omitted"), []);
});

test("a value the evidence marks internal-only is a disclosure error, not advice", () => {
  const leaked = evaluateMetricContext({
    text: "Cut P95 catalog request completion latency by 74%.",
    context: context({ disclosure: "internal_only" }),
  });
  const issue = leaked.find((entry) => entry.code === "metric_disclosure_conflict");
  assert.equal(issue.severity, "error");
  assert.equal(suggestRepresentation(context({ disclosure: "internal_only" })), "qualitative");
  assert.equal(suggestRepresentation(context({ disclosure: "internal_generalizable" })), "relative");
  assert.equal(
    suggestRepresentation(context({ disclosure: "public", readerInterpretationRisk: "low" })),
    "absolute",
  );
});

test("a number that is not in its source is never rendered", () => {
  const invented = evaluateMetricContext({
    text: "Cut P95 catalog request completion latency by 91%.",
    context: context(),
    claim: claimLedger.claims.find((entry) => entry.id === "claim-catalog-latency"),
  });
  const issue = invented.find((entry) => entry.code === "metric_not_in_source");
  assert.ok(issue);
  assert.equal(issue.severity, "error");

  const faithful = evaluateMetricContext({
    text: "Helped cut P95 catalog request completion latency by 74%.",
    context: context(),
    claim: claimLedger.claims.find((entry) => entry.id === "claim-catalog-latency"),
  });
  assert.deepEqual(faithful.filter((entry) => entry.code === "metric_not_in_source"), []);
});

test("an interpretable, externally safe absolute is left alone", () => {
  const fine = evaluateMetricContext({
    text: "Cut catalog page load time from 4.0 seconds to 1.4 seconds on median mobile hardware.",
    context: context({
      measuredObject: "catalog page load",
      latencySemantics: "not_a_latency_metric",
      statistic: "median",
      environment: "production_telemetry",
      comparator: { baseline: "4.0 seconds", endpoint: "1.4 seconds", relativeChange: "", window: "" },
      attribution: "owned_end_to_end",
      readerInterpretationRisk: "low",
      representation: "absolute",
    }),
  });
  assert.deepEqual(fine, [], JSON.stringify(fine, null, 2));
});

test("spans with no number are not inspected at all", () => {
  assert.deepEqual(detectMetrics("Led a legacy dashboard migration to typed components."), []);
  assert.deepEqual(
    evaluateMetricContext({ text: "Led a legacy dashboard migration to typed components.", context: null }),
    [],
  );
});

test("a rendered number with no recorded context is reported before anything else", () => {
  const baseline = approvedBaseline();
  const resume = withBullets(baseline, "example-current", [
    "Cut catalog request completion latency 74%.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["claim-catalog-latency"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const result = evaluateMetricContexts({
    resume,
    contexts: [],
    claimLedger,
    baselineView: baselineEditorialView(baseline),
    segments: segmentResume(resume),
  });
  assert.ok(result.warnings.some((issue) => issue.code === "metric_context_absent"));
  assert.equal(result.valid, true, "an undescribed metric is a gap in the record, not a fabrication");
});
