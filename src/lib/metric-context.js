import { z } from "zod";

/**
 * The metric-context gate.
 *
 * Two judgments were collapsed into one everywhere in this pipeline: *is this
 * number supported* and *will a reader understand what it measured*. The first
 * is claim validation's job and it does it well. The second has no owner, and
 * without one a bullet can be numerically exact and still leave a hiring
 * manager with a materially wrong picture.
 *
 * The failure is not exaggeration. It is that the measurement boundary is
 * invisible: a completion figure read as time-to-first-token, a shared
 * platform's result read as sole ownership, a benchmark read as production. In
 * every case the sentence is true and the reader is wrong, and the candidate
 * pays for it.
 *
 * So a number is described here before it is rendered, and the description --
 * not the number -- decides the representation.
 */

export const LATENCY_SEMANTICS = [
  "first_output",
  "first_useful_output",
  "full_completion",
  "component_only",
  "not_a_latency_metric",
  "unspecified",
];

export const MEASUREMENT_ENVIRONMENTS = [
  "production_telemetry",
  "staging",
  "local_benchmark",
  "manual_observation",
  "estimate",
];

export const STATISTICS = ["average", "median", "p50", "p90", "p95", "p99", "max", "total", "count", "ratio", "unspecified"];

export const ATTRIBUTION_SCOPES = ["owned_end_to_end", "owned_component", "shared_platform", "contributed", "reviewed"];

export const ZMetricContext = z.object({
  location: z.string().min(1),
  claimId: z.string().min(1),
  // 1. What operation, workflow or outcome was measured.
  measuredObject: z.string().min(1),
  // 2. One component, an application pipeline, or the complete end-to-end path.
  boundary: z.enum(["component", "application_pipeline", "end_to_end_path", "organisational"]),
  // 3. First output vs full completion, when that distinction is material.
  latencySemantics: z.enum(LATENCY_SEMANTICS).default("not_a_latency_metric"),
  // 4. Statistic and environment.
  statistic: z.enum(STATISTICS).default("unspecified"),
  environment: z.enum(MEASUREMENT_ENVIRONMENTS),
  // 5. Comparator: baseline, endpoint, relative change, time window.
  comparator: z.object({
    baseline: z.string().default(""),
    endpoint: z.string().default(""),
    relativeChange: z.string().default(""),
    window: z.string().default(""),
  }).strict().default({ baseline: "", endpoint: "", relativeChange: "", window: "" }),
  // 6. What the candidate changed, versus what was shared or inherited.
  attribution: z.enum(ATTRIBUTION_SCOPES),
  // 7. Whether the raw value is externally safe.
  disclosure: z.enum(["public", "internal_generalizable", "internal_only"]).default("public"),
  // 8. The author's own assessment, recorded so a reviewer can disagree with it.
  readerInterpretationRisk: z.enum(["low", "material", "high"]).default("low"),
  representation: z.enum(["absolute", "relative", "qualitative"]),
}).strict();

const PERCENTAGE = /(\d+(?:\.\d+)?)\s*(?:%|percent)/gi;
const DURATION = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|min(?:ute)?s?|hours?|days?|weeks?)\b/gi;
const PERCENTILE = /\bp(?:50|75|90|95|99(?:\.\d+)?)\b/gi;
const BARE_NUMBER = /\b\d[\d,]*(?:\.\d+)?\b/g;

export function detectMetrics(text) {
  const source = String(text || "");
  const found = [];
  for (const match of source.matchAll(PERCENTAGE)) found.push({ kind: "percentage", raw: match[0], value: match[1] });
  for (const match of source.matchAll(DURATION)) found.push({ kind: "duration", raw: match[0], value: match[1], unit: match[2] });
  for (const match of source.matchAll(PERCENTILE)) found.push({ kind: "percentile", raw: match[0] });
  if (!found.length) {
    for (const match of source.matchAll(BARE_NUMBER)) found.push({ kind: "count", raw: match[0], value: match[0] });
  }
  return found;
}

export function hasMetric(text) {
  return detectMetrics(text).length > 0;
}

const LATENCY_WORDS = /\b(?:latency|response time|load time|page load|duration|p50|p75|p90|p95|p99|time to|took)\b/i;
const COMPLETION_WORDS = /\b(?:completion|end-to-end|end to end|full response|finish(?:ed|ing)?)\b/i;
const FIRST_OUTPUT_WORDS = /\b(?:first token|first byte|time to first|ttft|ttfb|initial response)\b/i;
const SHARED_ATTRIBUTION_VERBS = /\b(?:helped|contributed|partnered|co-designed|supported|assisted)\b/i;
const OWNERSHIP_VERBS = /\b(?:led|owned|drove|architected|single-handedly|solely)\b/i;
const ENVIRONMENT_WORDS = {
  local_benchmark: /\b(?:benchmark|benchmarked|lab|synthetic)\b/i,
  manual_observation: /\b(?:manual(?:ly)?|observed|spot[- ]check)\b/i,
  estimate: /\b(?:estimat(?:e|ed|ion)|approximate(?:ly)?|roughly|about)\b/i,
  staging: /\b(?:staging|pre-production|preprod)\b/i,
  production_telemetry: /\b(?:production|telemetry|in production)\b/i,
};

/**
 * Evaluate one rendered metric-bearing span against its recorded context.
 *
 * Everything here is advisory. A number whose boundary is invisible is an
 * interpretation problem, not a fabrication, and PHILOSOPHY.md reserves hard
 * reporting for evidence, attribution, disclosure and artifact integrity. The
 * one exception is disclosure: printing a value the evidence record marks
 * internal-only crosses a boundary that is not the operator's to trade away by
 * preference, so it is reported as an error.
 */
export function evaluateMetricContext({ text, context, claim = null, baselineText = null }) {
  const issues = [];
  const rendered = String(text || "");
  const metrics = detectMetrics(rendered);
  const location = context?.location || "";
  const add = (severity, code, message, route) => issues.push({ severity, code, location, message, route });

  if (!metrics.length) return issues;

  if (!context) {
    add(
      "warning",
      "metric_context_absent",
      `${location} renders a number with no recorded measurement context. ` +
      "Record the measured object, boundary, statistic, environment, comparator, and attribution first.",
      "make_specific",
    );
    return issues;
  }

  // 1 & 2: the measured object and boundary have to be visible in the sentence,
  // not merely recorded in a plan the reader will never see.
  const objectVisible = context.measuredObject
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 3)
    .some((token) => rendered.toLowerCase().includes(token));
  if (!objectVisible) {
    add(
      "warning",
      "metric_missing_measurement_boundary",
      `${location} prints ${metrics[0].raw} without naming what was measured. The context records ` +
      `"${context.measuredObject}"; the reader sees only the number.`,
      "make_specific",
    );
  }

  // 3: first output versus full completion, when it is material.
  const looksLikeLatency = LATENCY_WORDS.test(rendered) || metrics.some((entry) => entry.kind === "duration");
  if (looksLikeLatency && context.latencySemantics !== "not_a_latency_metric") {
    const statesCompletion = COMPLETION_WORDS.test(rendered);
    const statesFirstOutput = FIRST_OUTPUT_WORDS.test(rendered);
    const material = context.latencySemantics === "full_completion" || context.latencySemantics === "first_output";
    if (material && !statesCompletion && !statesFirstOutput) {
      add(
        "warning",
        "latency_semantics_ambiguous",
        `${location} reports a latency figure measured as "${context.latencySemantics}" without saying so. ` +
        "A reader will compare it against whichever milestone they have in mind.",
        "make_specific",
      );
    }
    if (context.latencySemantics === "full_completion" && statesFirstOutput) {
      add(
        "error",
        "latency_semantics_ambiguous",
        `${location} describes first-output timing, but the evidence measured full completion.`,
        "rewrite",
      );
    }
  }

  // 4: statistic and environment.
  if (["p50", "p90", "p95", "p99", "median"].includes(context.statistic)) {
    if (!new RegExp(`\\b${context.statistic}\\b|\\bmedian\\b`, "i").test(rendered)) {
      add(
        "warning",
        "metric_statistic_flattened",
        `${location} reports a ${context.statistic} measurement without naming the statistic. ` +
        "An unlabelled number reads as an average, which is a different and usually flattering claim.",
        "make_specific",
      );
    }
  }
  if (["local_benchmark", "manual_observation", "estimate", "staging"].includes(context.environment)) {
    if (!ENVIRONMENT_WORDS[context.environment].test(rendered)) {
      add(
        "warning",
        "metric_environment_omitted",
        `${location} was measured by ${context.environment.replace(/_/g, " ")}, which the sentence does not say. ` +
        "Read without it, the figure looks like production telemetry.",
        "make_specific",
      );
    }
  }

  // 5: a percentage is not a shortcut around an ambiguous absolute.
  const percentages = metrics.filter((entry) => entry.kind === "percentage");
  if (percentages.length) {
    const hasComparator =
      Boolean(context.comparator?.baseline) ||
      Boolean(context.comparator?.relativeChange) ||
      /\bfrom\b.*\bto\b|\bcompared\b|\bbaseline\b/i.test(rendered);
    if (!hasComparator || !objectVisible) {
      add(
        "warning",
        "naked_percentage_without_boundary",
        `${location} renders ${percentages[0].raw} without the measured object and comparison it is a ` +
        "percentage of. Replacing an ambiguous absolute with an ambiguous percentage moves the ambiguity, " +
        "it does not remove it.",
        "make_specific",
      );
    }
  }

  // 6: attribution.
  if (["shared_platform", "contributed", "reviewed"].includes(context.attribution)) {
    if (OWNERSHIP_VERBS.test(rendered) && !SHARED_ATTRIBUTION_VERBS.test(rendered)) {
      add(
        "error",
        "metric_attribution_scope_mismatch",
        `${location} uses ownership wording for a result recorded as "${context.attribution}". ` +
        "The measured path was wider than the supported contribution.",
        "rewrite",
      );
    }
  }

  // 7: disclosure.
  if (context.disclosure === "internal_only") {
    add(
      "error",
      "metric_disclosure_conflict",
      `${location} renders a value whose evidence record is internal-only.`,
      "rewrite",
    );
  }
  if (context.disclosure === "internal_generalizable" && context.representation === "absolute") {
    add(
      "warning",
      "metric_disclosure_conflict",
      `${location} renders an absolute value for a metric the evidence record permits only in generalized form.`,
      "rewrite",
    );
  }

  // 8: the author's own risk assessment, taken seriously.
  if (context.readerInterpretationRisk === "high" && context.representation === "absolute") {
    add(
      "warning",
      "metric_requires_excessive_context",
      `${location} keeps an absolute value the author rated high interpretation risk. ` +
      "A scoped relative result or a concrete qualitative consequence may communicate it more faithfully.",
      "rewrite",
    );
  }

  // Regression guard against the specific compression failure: a revision that
  // drops the percentile and keeps the number. The sentence gets shorter and
  // the claim gets larger.
  if (baselineText) {
    const before = [...String(baselineText).matchAll(PERCENTILE)].map((match) => match[0].toLowerCase());
    const after = [...rendered.matchAll(PERCENTILE)].map((match) => match[0].toLowerCase());
    for (const percentile of before) {
      if (!after.includes(percentile)) {
        add(
          "warning",
          "metric_statistic_flattened",
          `${location} dropped "${percentile}" from the approved wording. A tail-latency result read as an ` +
          "average is a different claim.",
          "keep",
        );
      }
    }
  }

  if (claim) {
    const factNumbers = new Set(
      [...`${claim.fact} ${claim.externalFact || ""}`.matchAll(BARE_NUMBER)]
        .map((match) => match[0].replace(/,/g, ""))
    );
    for (const metric of metrics) {
      if (!metric.value) continue;
      const value = String(metric.value).replace(/,/g, "");
      if (!factNumbers.has(value)) {
        add(
          "error",
          "metric_not_in_source",
          `${location} prints "${metric.raw}", which does not appear in claim ${claim.id}.`,
          "rewrite",
        );
      }
    }
  }

  return issues;
}

/**
 * Advisory guidance, kept as data so a skill and a test read the same rule.
 */
export function suggestRepresentation(context) {
  if (!context) return "absolute";
  if (context.disclosure === "internal_only") return "qualitative";
  if (context.disclosure === "internal_generalizable") return "relative";
  if (context.readerInterpretationRisk === "high") return "qualitative";
  if (context.readerInterpretationRisk === "material") return "relative";
  return "absolute";
}

export function evaluateMetricContexts({ resume, contexts = [], claimLedger = null, baselineView = null, segments = [] }) {
  const byLocation = new Map(contexts.map((entry) => [entry.location, entry]));
  const claims = new Map((claimLedger?.claims || []).map((claim) => [claim.id, claim]));
  const baselineByLocation = new Map(
    (baselineView?.segments || []).map((entry) => [entry.location, entry.text])
  );

  const issues = [];
  for (const segment of segments) {
    if (!hasMetric(segment.text)) continue;
    const context = byLocation.get(segment.location) || null;
    issues.push(...evaluateMetricContext({
      text: segment.text,
      context: context ? { ...context, location: segment.location } : null,
      claim: context ? claims.get(context.claimId) || null : null,
      baselineText: baselineByLocation.get(segment.location) || null,
    }));
  }
  const errors = issues.filter((entry) => entry.severity === "error");
  return {
    schemaVersion: "1.0",
    valid: errors.length === 0,
    issues: errors,
    warnings: issues.filter((entry) => entry.severity !== "error"),
  };
}
