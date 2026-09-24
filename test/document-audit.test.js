import test from "node:test";
import assert from "node:assert/strict";

import {
  auditDocument,
  clauseShape,
  isNounStack,
  seniorityMarkers,
} from "../src/lib/document-audit.js";
import { baselineEditorialView } from "../src/lib/editorial-baseline.js";

import {
  approvedBaseline,
  claimLedger,
  jobSpec,
  withBullets,
  withSummarySentences,
} from "./fixtures/editorial.js";

/**
 * The defects no single-sentence check can see.
 *
 * Each resume below would pass claim validation completely. What is wrong with
 * them is a relationship between sentences, which is exactly the information a
 * per-span validator throws away.
 */

const baseline = approvedBaseline();
const view = baselineEditorialView(baseline);

/* ------------------------------------------------------- required item 9 */

test("repeated bullet openings are found at whole-document level", () => {
  const repeated = withBullets(baseline, "example-current", [
    "Designed and built a multi-source catalog pipeline that kept producing usable results when sources failed.",
    "Designed and built the automated release validation checks that run before every deploy.",
    "Led migration of a legacy dashboard to a typed component architecture.",
  ], [["claim-catalog-pipeline"], ["claim-release-checks"], ["claim-dashboard-migration"]]);

  const audit = auditDocument({ resume: repeated, jobSpec, claimLedger });
  const repetition = audit.warnings.filter((entry) => entry.code === "whole_document_repetition");

  const openings = repetition.find((entry) => /open with "designed and"/i.test(entry.message));
  assert.ok(openings, JSON.stringify(repetition, null, 2));
  assert.match(openings.location, /experience\[0\]\.bullets\[0\]/);
  assert.match(openings.location, /experience\[0\]\.bullets\[1\]/);

  // Each bullet is individually fine, which is the point.
  assert.equal(audit.valid, true);
});

test("repeated clause shapes are found even when the vocabulary differs", () => {
  const mechanical = withBullets(baseline, "example-current", [
    "Migrated the catalog retrieval path, reducing failed requests by 40%.",
    "Replaced the reporting surface, cutting duplicated queries by 30%.",
    "Consolidated the release script, shortening deploy time by 20%.",
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const audit = auditDocument({ resume: mechanical, jobSpec, claimLedger });
  const cadence = audit.warnings.find((entry) =>
    entry.code === "whole_document_repetition" && /clause shape/.test(entry.message));

  assert.ok(cadence, JSON.stringify(audit.warnings, null, 2));
  assert.equal(
    new Set([
      clauseShape(mechanical.experience[0].bullets[0]),
      clauseShape(mechanical.experience[0].bullets[1]),
      clauseShape(mechanical.experience[0].bullets[2]),
    ]).size,
    1,
    "these three sentences share one fingerprint despite sharing no nouns",
  );
});

test("noun stacking is reported as content that belongs in another section", () => {
  assert.equal(
    isNounStack("Content hashes, checkpoints, locks, deadlines, cancellation, and atomic writes."),
    true,
  );
  assert.equal(
    isNounStack("Rebuilt the ingest path, adding checkpoints so interrupted runs resumed without repeating work."),
    false,
  );

  const stacked = withBullets(baseline, "example-current", [
    "Catalog pipeline: content hashes, checkpoints, locks, deadlines, cancellation, atomic writes.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const audit = auditDocument({ resume: stacked, jobSpec, claimLedger });
  const stack = audit.warnings.find((entry) =>
    entry.location === "experience[0].bullets[0]" && /list of nouns/.test(entry.message));
  assert.ok(stack, JSON.stringify(audit.warnings, null, 2));
  assert.equal(stack.route, "move");
});

/* ------------------------------------------------------ required item 10 */

test("purposeful retrieval repetition is distinguished from redundant prose", () => {
  // Purposeful: "TypeScript" is in Skills for retrieval and inside the bullet
  // that proves it. Two readers, two jobs, one term. Nothing may report this.
  const purposeful = withBullets(baseline, "example-current", [
    "Led migration of a legacy dashboard to a typed TypeScript component architecture, owning rollout and deprecation.",
    baseline.experience[0].bullets[0],
    baseline.experience[0].bullets[2],
  ], [["claim-dashboard-migration"], ["claim-catalog-pipeline"], ["claim-release-checks"]]);

  const clean = auditDocument({ resume: purposeful, jobSpec, claimLedger });
  assert.deepEqual(
    clean.warnings.filter((entry) =>
      entry.code === "whole_document_repetition" && /restates/.test(entry.message)),
    [],
  );

  // Redundant: the Summary previews a bullet instead of interpreting it.
  const redundant = withSummarySentences(
    purposeful,
    [
      baseline.provenance.summary[0].text,
      "Led migration of a legacy dashboard to a typed TypeScript component architecture, owning rollout and deprecation.",
    ],
    [
      { claimIds: ["claim-tenure"], unitIds: [] },
      { claimIds: ["claim-dashboard-migration"], unitIds: ["unit-dashboard"] },
    ],
  );

  const audit = auditDocument({ resume: redundant, jobSpec, claimLedger });
  const restatement = audit.warnings.find((entry) => /restates/.test(entry.message));
  assert.ok(restatement, JSON.stringify(audit.warnings, null, 2));
  assert.match(restatement.message, /interpret what the bullets prove/);
});

test("two bullets proving the same thing are reported as duplicate purposes", () => {
  const duplicated = withBullets(baseline, "example-current", [
    "Built the automated release validation checks that run before every deploy, including regression evaluation.",
    "Built automated release validation checks that run before each deploy, including regression evaluation.",
    baseline.experience[0].bullets[1],
  ], [["claim-release-checks"], ["claim-release-checks"], ["claim-dashboard-migration"]]);

  const audit = auditDocument({ resume: duplicated, jobSpec, claimLedger });
  assert.ok(audit.warnings.some((entry) => entry.code === "bullet_purpose_duplicate"));
});

/* ------------------------------------------------------ required item 11 */

test("compression that drops evidence of level is a regression, not a saving", () => {
  assert.deepEqual(
    seniorityMarkers(
      "Designed and built a multi-source catalog pipeline that kept producing usable results when individual sources failed.",
    ).sort(),
    ["architecture", "reliability", "scope"],
  );

  const compressed = withBullets(baseline, "example-current", [
    // Shorter. Every fact still true. Architecture, reliability and multi-source
    // scope are gone.
    "Worked on the catalog pipeline.",
    // Lifecycle ownership removed: the migration, rollout and deprecation go.
    "Updated a legacy dashboard to typed components.",
    // Evaluation removed.
    "Built release checks.",
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const audit = auditDocument({ resume: compressed, baselineView: view, jobSpec, claimLedger });
  const losses = audit.warnings.filter((entry) => entry.code === "seniority_scope_loss");

  assert.equal(losses.length, 3, JSON.stringify(audit.warnings, null, 2));
  const combined = losses.map((entry) => entry.message).join("\n");
  assert.match(combined, /architecture/);
  assert.match(combined, /reliability/);
  assert.match(combined, /lifecycle/);
  assert.match(combined, /ownership/);
  assert.match(combined, /evaluation/);
  assert.ok(losses.every((entry) => entry.route === "keep"));
  assert.match(losses[0].message, /evidence of level/);
});

test("compression that keeps the evidence of level raises nothing", () => {
  const tightened = withBullets(baseline, "example-current", [
    "Designed a multi-source catalog pipeline that kept producing usable results when individual sources failed.",
    "Led a legacy dashboard migration to typed components, owning design, rollout and deprecation.",
    "Built the release validation checks that gate every deploy, including regression evaluation of generated output.",
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const audit = auditDocument({ resume: tightened, baselineView: view, jobSpec, claimLedger });
  assert.deepEqual(audit.warnings.filter((entry) => entry.code === "seniority_scope_loss"), []);
});

/* ------------------------------------------------------------- voice drift */

test("rewriting approved wording without changing meaning is reported as drift", () => {
  const operations = view.segments.slice(0, 6).map((segment) => ({
    location: segment.location,
    operation: "rewrite",
    semanticDelta: "none",
    reason: "style",
  }));

  const audit = auditDocument({
    resume: baseline,
    baselineView: view,
    editorialPlan: { operations },
    jobSpec,
    claimLedger,
  });
  const drift = audit.warnings.find((entry) => entry.code === "baseline_voice_drift");
  assert.ok(drift, JSON.stringify(audit.warnings, null, 2));
  assert.match(drift.message, /without changing what is said/);
  assert.equal(drift.route, "keep");
});

/* ------------------------------------------------------------- authority */

test("the audit never blocks on editorial judgment", () => {
  const messy = withBullets(baseline, "example-current", [
    "Designed and built a catalog pipeline, reducing failures by 40%.",
    "Designed and built a reporting surface, reducing queries by 30%.",
    "Designed and built a release script, reducing deploy time by 20%.",
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const audit = auditDocument({ resume: messy, baselineView: view, jobSpec, claimLedger });
  assert.ok(audit.warnings.length > 0, "this document has real editorial problems");
  assert.equal(audit.valid, true, "none of them is Labora's to enforce");
  assert.deepEqual(audit.issues, []);
});

test("no audit finding is emitted without an operation that would resolve it", () => {
  const messy = withBullets(baseline, "example-current", [
    "Designed and built a catalog pipeline, reducing failures by 40%.",
    "Designed and built a reporting surface, reducing queries by 30%.",
    "Designed and built a release script, reducing deploy time by 20%.",
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const audit = auditDocument({ resume: messy, baselineView: view, jobSpec, claimLedger });
  const actionable = audit.warnings.filter((entry) => entry.severity === "warning");
  for (const entry of actionable) {
    assert.ok(
      entry.route || /check that it does here|Confirm another selected bullet/.test(entry.message),
      `${entry.code} reports a problem with no route out of it`,
    );
  }
});

/* ----------------------------------- the audit runs the other gates too */

test("the metric gate runs inside the document audit, not as an unreachable library", () => {
  const withMetric = withBullets(baseline, "example-current", [
    "Cut catalog request completion latency 74%.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["claim-catalog-latency"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const undescribed = auditDocument({ resume: withMetric, jobSpec, claimLedger });
  assert.ok(
    undescribed.warnings.some((entry) => entry.code === "metric_context_absent"),
    JSON.stringify(undescribed.warnings, null, 2),
  );

  const described = auditDocument({
    resume: withMetric,
    jobSpec,
    claimLedger,
    metricContexts: [{
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
    }],
  });
  assert.deepEqual(
    described.warnings.filter((entry) => entry.code === "metric_context_absent"),
    [],
  );
  // The described metric still renders its p95 measurement unlabelled, so the
  // gate reports that rather than passing it silently. It does *not* report
  // ambiguous latency semantics, because the sentence says "completion".
  const codes = described.warnings.map((entry) => entry.code);
  assert.ok(codes.includes("metric_statistic_flattened"), JSON.stringify(described.warnings, null, 2));
  assert.ok(!codes.includes("latency_semantics_ambiguous"));
});

test("the decidable half of the cold-reader gate runs inside the document audit", () => {
  const labelled = withBullets(baseline, "example-current", [
    "Delivered a configuration console to Private Preview as ship owner.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["claim-dashboard-migration"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const audit = auditDocument({
    resume: labelled,
    jobSpec,
    claimLedger,
    postingText: "Platform engineering role.",
  });
  const codes = audit.warnings.map((entry) => entry.code);
  assert.ok(codes.includes("rollout_label_without_scope"), JSON.stringify(audit.warnings, null, 2));
  assert.ok(codes.includes("internal_role_label"));
  // Still advisory: an opaque label is a communication problem, not a lie.
  assert.equal(audit.valid, true);
});

/* --------------------------------------------- no detector-evasion logic */

test("the audit contains no AI-detector scoring or synonym randomisation", async () => {
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/lib/document-audit.js", import.meta.url), "utf8"));
  for (const forbidden of ["burstiness", "perplexity", "detector", "humanize", "synonym"]) {
    assert.ok(
      !source.toLowerCase().includes(forbidden),
      `"${forbidden}" would make this a detector-evasion tool rather than an editor`,
    );
  }
});
