import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  baselineContractFor,
  baselineEditorialView,
  evaluateBaseline,
  evidenceLeaksInEditorialView,
  loadBaseline,
  sha256,
} from "../src/lib/editorial-baseline.js";
import { validateEditorialPlan } from "../src/lib/editorial-plan.js";
import { diffSegments, segmentResume } from "../src/lib/resume-segments.js";
import { validateApplicationStrategy } from "../src/lib/application-strategy.js";
import { approvalStatus } from "../src/lib/release-state.js";
import { ZApplicationStrategy } from "../src/schemas/application-strategy.js";
import { ZBaselineResumeContract } from "../src/schemas/editorial.js";

import {
  accomplishmentBank,
  approvedBaseline,
  claimLedger,
  emptyPlan,
  jobSpec,
  keepAll,
  withBullets,
  withSummarySentences,
} from "./fixtures/editorial.js";

const baseline = approvedBaseline();
const view = baselineEditorialView(baseline);
const bytes = Buffer.from(JSON.stringify(baseline), "utf8");
const hash = sha256(bytes);

function plan(operations, overrides = {}) {
  return { ...emptyPlan, baselineHash: hash, operations, ...overrides };
}

function run(operations, revised, overrides = {}) {
  return validateEditorialPlan({
    plan: plan(operations, overrides),
    baselineView: view,
    revised,
    claimLedger,
    bank: accomplishmentBank,
    baselineApproved: true,
    baselineHash: hash,
  });
}

/* ------------------------------------------------------- required item 1 */

test("an approved sentence stays byte-identical when nothing justifies changing it", () => {
  const result = run(keepAll(view), baseline);

  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.coverage.changedLocations, []);
  assert.deepEqual(result.coverage.unexplainedLocations, []);

  // The guarantee is byte equality, not "close enough". A diff that normalised
  // whitespace would let an approved semicolon become a comma for free.
  const diff = diffSegments(view.segments, segmentResume(baseline));
  assert.equal(diff.modified.length, 0);
  assert.equal(diff.preservedCount, undefined);
  assert.equal(diff.unchanged.length, view.segments.length);
  for (const entry of diff.unchanged) {
    assert.equal(entry.before.text, entry.after.text);
  }
});

test("preserving wording does not exempt it from grounding", () => {
  // The baseline said it; the ledger has to still say it. A kept sentence whose
  // provenance disappeared is the exact path by which a baseline would become a
  // source.
  const stripped = {
    ...baseline,
    provenance: {
      ...baseline.provenance,
      bullets: baseline.provenance.bullets.filter(
        (entry) => !(entry.experienceId === "example-current" && entry.bulletIndex === 0)
      ),
    },
  };
  const result = run(keepAll(view), stripped);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes("kept_span_without_provenance"), JSON.stringify(codes));
});

/* ------------------------------------------------------- required item 2 */

test("changing the baseline invalidates its approval by hash", () => {
  const contract = baselineContractFor({
    filePath: "resume-approved.json",
    bytes,
    approval: "operator",
    approvedAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(evaluateBaseline({ contract, bytes }).approved, true);

  const edited = Buffer.from(JSON.stringify({ ...baseline, ats_title: "Platform Engineer" }), "utf8");
  const status = evaluateBaseline({ contract, bytes: edited });
  assert.equal(status.approved, false);
  assert.equal(status.usable, false);
  assert.match(status.reason, /changed after it was recorded/);

  // And the reason names what changed rather than only that something did.
  assert.match(status.reason, /Re-record the baseline/);
});

test("an unreadable baseline is reported rather than treated as absent", () => {
  const contract = baselineContractFor({ filePath: "missing.json", bytes, approval: "operator" });
  const status = evaluateBaseline({ contract, bytes: null });
  assert.equal(status.present, true);
  assert.equal(status.usable, false);
  assert.match(status.reason, /could not be read/);
});

test("a strategy naming a changed baseline fails strategy validation", () => {
  const strategy = ZApplicationStrategy.parse({
    ...minimalStrategy(),
    baselineResume: ZBaselineResumeContract.parse({
      path: "resume-approved.json",
      sha256: hash,
      approval: "operator",
      approvedAt: "2026-01-01T00:00:00Z",
    }),
  });
  const ok = validateApplicationStrategy({ strategy, jobSpec, claimLedger, baselineBytes: bytes });
  assert.ok(!ok.issues.some((issue) => issue.code === "baseline_unusable"));

  const drifted = validateApplicationStrategy({
    strategy,
    jobSpec,
    claimLedger,
    baselineBytes: Buffer.from("{}", "utf8"),
  });
  assert.ok(drifted.issues.some((issue) => issue.code === "baseline_unusable"));
});

/* ---------------------------------------------- the baseline is not evidence */

test("the editorial view of a baseline carries nothing that could ground a claim", () => {
  assert.deepEqual(evidenceLeaksInEditorialView(view), []);
  assert.equal("provenance" in view, false);
  for (const segment of view.segments) {
    assert.deepEqual(Object.keys(segment).sort(), ["hash", "kind", "location", "section", "text"]);
  }

  // Positive control: the detector has to actually detect, or the assertion
  // above is a tautology that would keep passing after the guarantee broke.
  assert.deepEqual(
    evidenceLeaksInEditorialView({ segments: [{ text: "x", provenance: { bullets: [] } }] }),
    ["baseline.segments[0].provenance"],
  );
  assert.deepEqual(
    evidenceLeaksInEditorialView({ segments: [{ text: "x", claimIds: ["claim-tenure"] }] }),
    ["baseline.segments[0].claimIds"],
  );
});

test("an operation may not cite the baseline as its source", () => {
  const revised = withBullets(baseline, "example-current", [
    "Rebuilt the catalog pipeline so provider failures no longer stall the request path.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["baseline:experience[0].bullets[0]"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const result = run([
    ...keepAll(view).filter((operation) => operation.location !== "experience[0].bullets[0]"),
    {
      location: "experience[0].bullets[0]",
      operation: "rewrite",
      originalText: baseline.experience[0].bullets[0],
      proposedText: revised.experience[0].bullets[0],
      destination: "",
      additionalSources: [],
      products: [],
      reason: "shorter",
      semanticDelta: "none",
      claimIds: ["baseline:experience[0].bullets[0]"],
      unitIds: [],
      affects: [],
      requiresReapproval: false,
    },
  ], revised);

  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes("baseline_cited_as_evidence"), JSON.stringify(codes));
});

/* ------------------------------------------------------- required item 3 */

test("every changed approved span needs an operation and a reason", () => {
  const revised = withBullets(baseline, "example-current", [
    "Built a catalog pipeline with concurrent retrieval.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  // No operation at all: the change is unexplained.
  const silent = run(keepAll(view).filter((operation) => operation.location !== "experience[0].bullets[0]"), revised);
  assert.equal(silent.valid, false);
  assert.ok(silent.issues.some((issue) =>
    issue.code === "approved_baseline_changed_without_reason" &&
    issue.location === "experience[0].bullets[0]"));

  // An operation with no reason is equally unexplained.
  const unreasoned = run([
    ...keepAll(view).filter((operation) => operation.location !== "experience[0].bullets[0]"),
    {
      location: "experience[0].bullets[0]",
      operation: "rewrite",
      originalText: baseline.experience[0].bullets[0],
      proposedText: revised.experience[0].bullets[0],
      destination: "",
      additionalSources: [],
      products: [],
      reason: "   ",
      semanticDelta: "narrowed",
      claimIds: ["claim-catalog-pipeline"],
      unitIds: [],
      affects: [],
      requiresReapproval: true,
    },
  ], revised);
  assert.ok(unreasoned.issues.some((issue) => issue.code === "operation_without_reason"));
});

test("a keep operation cannot cover a span whose wording changed", () => {
  const revised = withBullets(baseline, "example-current", [
    "Built a catalog pipeline with concurrent retrieval.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const result = run(keepAll(view), revised);
  assert.ok(result.issues.some((issue) => issue.code === "keep_operation_text_changed"));
});

test("a rewrite must record whether meaning changed", () => {
  // The schema supplies "none" by default, so the check that matters is the
  // one that catches a declared delta contradicting the operation.
  const revised = withBullets(baseline, "example-current", [
    "Designed and built the multi-source catalog platform adopted across every product team.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const result = run([
    ...keepAll(view).filter((operation) => operation.location !== "experience[0].bullets[0]"),
    {
      location: "experience[0].bullets[0]",
      operation: "make_specific",
      originalText: baseline.experience[0].bullets[0],
      proposedText: revised.experience[0].bullets[0],
      destination: "",
      additionalSources: [],
      products: [],
      reason: "name the adoption",
      semanticDelta: "broadened",
      claimIds: ["claim-catalog-pipeline"],
      unitIds: ["unit-catalog"],
      affects: [],
      requiresReapproval: true,
    },
  ], revised);
  assert.ok(result.issues.some((issue) => issue.code === "make_specific_broadened"));
});

test("rewrite is not the default, and overusing it is reported", () => {
  const rewrites = view.segments
    .filter((segment) => segment.section === "skills")
    .slice(0, 5)
    .map((segment) => ({
      location: segment.location,
      operation: "rewrite",
      originalText: segment.text,
      proposedText: segment.text,
      destination: "",
      additionalSources: [],
      products: [],
      reason: "wording",
      semanticDelta: "none",
      claimIds: [],
      unitIds: [],
      affects: [],
      requiresReapproval: false,
    }));
  const result = run([
    ...keepAll(view).filter((operation) => !rewrites.some((entry) => entry.location === operation.location)),
    ...rewrites,
  ], baseline);
  assert.ok(result.warnings.some((issue) => issue.code === "rewrite_used_as_default"));
});

/* ------------------------------------------------------ required item 16 */

test("approval goes stale when the baseline, the proposal or the accepted wording changes", () => {
  const release = {
    artifact: { hash: "b".repeat(64), path: "r.docx", type: "docx" },
    findings: [],
    state: "review_ready",
    editorial: {
      baselineHash: hash,
      editorialPlanHash: "c".repeat(64),
      revisedContentHash: "d".repeat(64),
    },
  };
  const approval = {
    artifactHash: "b".repeat(64),
    acceptedFindingIds: [],
    editorial: { ...release.editorial },
  };
  assert.equal(approvalStatus(release, approval).approved, true);

  for (const [field, expected] of [
    ["baselineHash", /approved baseline changed/],
    ["editorialPlanHash", /proposed edits changed/],
    ["revisedContentHash", /accepted wording changed/],
  ]) {
    const moved = { ...release, editorial: { ...release.editorial, [field]: "e".repeat(64) } };
    const status = approvalStatus(moved, approval);
    assert.equal(status.approved, false, field);
    assert.match(status.reason, expected);
  }

  // The artifact hash and the finding set keep working exactly as before.
  assert.equal(approvalStatus({ ...release, artifact: { ...release.artifact, hash: "f".repeat(64) } }, approval).approved, false);
  assert.equal(
    approvalStatus({ ...release, findings: [{ id: "f-000000000000" }] }, approval).approved,
    false,
  );
});

test("an approval written before editorial state existed still applies", () => {
  // Backward compatibility is a property, not a courtesy: invalidating every
  // historical approval the moment a new field appears would silently tell
  // people their reviewed documents were never reviewed.
  const release = {
    artifact: { hash: "b".repeat(64), path: "r.docx", type: "docx" },
    findings: [],
    state: "review_ready",
    editorial: { baselineHash: hash, editorialPlanHash: null, revisedContentHash: null },
  };
  const legacyApproval = { artifactHash: "b".repeat(64), acceptedFindingIds: [] };
  assert.equal(approvalStatus(release, legacyApproval).approved, true);
});

/* ------------------------------------------------------ required item 15 */

test("a strategy with no baseline validates exactly as it did before", () => {
  const strategy = ZApplicationStrategy.parse(minimalStrategy());
  assert.equal(strategy.baselineResume, null);

  const withoutBytes = validateApplicationStrategy({ strategy, jobSpec, claimLedger });
  const withBytes = validateApplicationStrategy({ strategy, jobSpec, claimLedger, baselineBytes: bytes });
  assert.deepEqual(
    withoutBytes.issues.map((issue) => issue.code).sort(),
    withBytes.issues.map((issue) => issue.code).sort(),
  );
  assert.ok(!withoutBytes.issues.some((issue) => issue.code.startsWith("baseline_")));
});

test("loadBaseline reports a missing file without throwing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-baseline-"));
  const contract = baselineContractFor({ filePath: "resume-approved.json", bytes, approval: "operator" });
  const absent = loadBaseline({ applicationDir: root, contract });
  assert.equal(absent.status.usable, false);

  fs.writeFileSync(path.join(root, "resume-approved.json"), bytes);
  const present = loadBaseline({ applicationDir: root, contract });
  assert.equal(present.status.approved, true);
  assert.equal(present.view.segments.length, view.segments.length);
  fs.rmSync(root, { recursive: true, force: true });
});

function minimalStrategy() {
  return {
    schemaVersion: "2.0",
    status: "ready",
    targetRole: "Senior Platform Engineer",
    company: "Example Industries",
    candidateNarrative: "Platform engineer with production ownership.",
    topSignals: [{
      signal: "Owns a multi-source pipeline end to end",
      requirementIds: ["req-typescript"],
      claimIds: ["claim-catalog-pipeline"],
      rationale: "Directly covers the service-layer requirement.",
    }],
    likelyConcerns: [],
    firstPagePlan: {
      headline: "Senior Platform Engineer",
      headlinePlan: { positioning: "Senior Platform Engineer", qualifiers: [] },
      summaryPlan: {
        identity: {
          engineerType: "Platform engineer",
          anchor: "seven years",
          scope: "services and web",
          claimIds: ["claim-tenure"],
          unitIds: [],
        },
        recentProof: {
          accomplishment: "catalog pipeline",
          contributionLevel: "sole_owner",
          concreteContext: "multi-source retrieval",
          claimIds: ["claim-catalog-pipeline"],
          primaryUnitId: "unit-catalog",
        },
        differentiator: null,
      },
      leadClaimIds: ["claim-catalog-pipeline"],
      skillsOrder: [],
    },
    unitShortlist: [],
    evidenceRequests: [],
    notesForHuman: [],
  };
}

export { baseline, view, hash, plan, run };
