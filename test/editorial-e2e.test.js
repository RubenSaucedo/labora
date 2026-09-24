import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { baselineEditorialView, sha256 } from "../src/lib/editorial-baseline.js";
import { validateEditorialPlan } from "../src/lib/editorial-plan.js";
import { auditDocument } from "../src/lib/document-audit.js";
import { evaluateQualityGate } from "../src/lib/quality-gate.js";
import { approvalStatus } from "../src/lib/release-state.js";
import { revalidateDependents } from "../src/lib/section-plans.js";
import { ZReleaseApproval, ZReleaseOutput } from "../src/schemas/release-output.js";
import { ZEditorialPlan } from "../src/schemas/editorial.js";
import { ZSkillsPlan } from "../src/schemas/section-plans.js";

import {
  accomplishmentBank,
  approvedBaseline,
  claimLedger,
  emptyPlan,
  jobSpec,
  withBullets,
  withSummarySentences,
} from "./fixtures/editorial.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const labora = (...args) =>
  spawnSync(process.execPath, [path.join(ROOT, "bin", "labora"), ...args], { encoding: "utf8" });

/**
 * One complete synthetic editorial run, end to end.
 *
 * A baseline is recorded and approved, a plan is written, a revision is
 * produced that keeps most of the approved wording and moves one thing,
 * everything is validated and audited, the gate reports, the operator approves,
 * and then the baseline changes underneath it and the approval goes stale.
 *
 * The individual behaviours have their own tests. What this proves is that the
 * pieces fit: the same hash flows from the contract through the plan into the
 * release record and the approval, and the same span addresses are used by the
 * plan, the audit and the skill dependency graph.
 */
test("a synthetic editorial run produces contract, plan, revision, audit and a staleable approval", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-editorial-e2e-"));
  const application = path.join(root, "applications", "example-platform-role");
  fs.mkdirSync(path.join(application, "validations"), { recursive: true });

  /* ------------------------------------------------ 1. record the baseline */
  const baseline = approvedBaseline();
  const baselinePath = path.join(application, "resume-approved.json");
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));

  const recorded = labora("baseline", application, "--record", "resume-approved.json", "--approved-by-operator");
  assert.equal(recorded.status, 0, recorded.stderr);
  const contract = JSON.parse(recorded.stdout);
  assert.equal(contract.approval, "operator");
  assert.equal(contract.sha256, sha256(fs.readFileSync(baselinePath)));

  const checked = labora("baseline", application, "--check");
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).approved, true);

  /* ------------------------------------------------- 2. revise the document */
  // One real edit: the lifecycle sentence in the Summary is doing Experience's
  // job, so it moves. Everything else the operator approved is kept untouched.
  const movedText = baseline.provenance.summary[1].text;
  const revised = withBullets(
    withSummarySentences(baseline, [baseline.provenance.summary[0].text], [{ claimIds: ["claim-tenure"], unitIds: [] }]),
    "example-current",
    [...baseline.experience[0].bullets, movedText],
    [
      ["claim-catalog-pipeline"],
      ["claim-dashboard-migration"],
      ["claim-release-checks"],
      ["claim-dashboard-migration", "claim-release-checks"],
    ],
  );
  const resumePath = path.join(application, "resume.json");
  fs.writeFileSync(resumePath, JSON.stringify(revised, null, 2));

  /* ------------------------------------------------------ 3. write the plan */
  const view = baselineEditorialView(baseline);
  const plan = ZEditorialPlan.parse({
    ...emptyPlan,
    baselineHash: contract.sha256,
    operations: [
      ...view.segments
        .filter((segment) => segment.location !== "summary.sentences[1]")
        .map((segment) => ({
          location: segment.location,
          operation: "keep",
          originalText: segment.text,
          requiresReapproval: false,
        })),
      {
        location: "summary.sentences[1]",
        operation: "move",
        originalText: movedText,
        destination: "experience[0].bullets[3]",
        reason: "Lifecycle detail proves the role rather than interpreting the career; Experience is where a reader looks for it.",
        semanticDelta: "moved",
        claimIds: ["claim-dashboard-migration", "claim-release-checks"],
        unitIds: ["unit-dashboard", "unit-release"],
        affects: ["skills.primary[2]"],
        requiresReapproval: true,
      },
    ],
  });
  const planPath = path.join(application, "editorial-plan.json");
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

  /* ---------------------------------------------------- 4. validate the plan */
  const claimsPath = path.join(root, "claims.json");
  const bankPath = path.join(root, "accomplishments.json");
  fs.writeFileSync(claimsPath, JSON.stringify(claimLedger, null, 2));
  fs.writeFileSync(bankPath, JSON.stringify(accomplishmentBank, null, 2));

  const validated = labora(
    "validate-editorial-plan", planPath, resumePath, claimsPath,
    "--application", application,
    "--accomplishments", bankPath,
    "--output", path.join(application, "validations", "editorial.json"),
  );
  assert.equal(validated.status, 0, validated.stdout + validated.stderr);
  const editorialValidation = JSON.parse(validated.stdout);
  assert.equal(editorialValidation.valid, true);

  // The operator approved 12 spans; 11 are byte-identical in the revision.
  assert.equal(
    editorialValidation.coverage.preservedLocations.length,
    view.segments.length - 1,
  );
  assert.deepEqual(editorialValidation.coverage.unexplainedLocations, []);
  assert.deepEqual(editorialValidation.reapproval, {
    required: true,
    locations: ["summary.sentences[1]"],
  });

  /* ------------------------------------------------------- 5. audit and plan */
  const jobSpecPath = path.join(application, "job-spec.json");
  fs.writeFileSync(jobSpecPath, JSON.stringify(jobSpec, null, 2));

  const audited = labora(
    "audit-document", resumePath,
    "--job-spec", jobSpecPath,
    "--claims", claimsPath,
    "--application", application,
    "--editorial-plan", planPath,
    "--output", path.join(application, "validations", "document-audit.json"),
  );
  // Advisory by construction: findings, exit 0.
  assert.equal(audited.status, 0, audited.stdout + audited.stderr);
  const documentAudit = JSON.parse(audited.stdout);
  assert.equal(documentAudit.valid, true);
  assert.deepEqual(documentAudit.issues, []);

  // The move is not a seniority loss: the sentence still exists, one address
  // further down.
  assert.deepEqual(
    documentAudit.warnings.filter((entry) =>
      entry.code === "seniority_scope_loss" && entry.severity === "warning"),
    [],
  );

  /* --------------------------------- 6. dependent sections are re-evaluated */
  const skillsPlan = ZSkillsPlan.parse({
    schemaVersion: "1.0",
    model: "hybrid",
    modelReason: "Concrete technologies plus the reliability capabilities the role centres on.",
    categories: [
      { label: "Languages & Runtime", reason: "retrieval of implementation languages", order: 1 },
      { label: "Reliability & Release", reason: "the capabilities the posting centres on", order: 2 },
    ],
    items: [
      {
        display: "TypeScript", canonical: "typescript", category: "Languages & Runtime",
        evidenceStatus: "demonstrated_recent", claimIds: ["claim-dashboard-migration"],
        supportingLocations: ["experience[0].bullets[1]"],
        targetRelevance: "high", depth: "material", decision: "include", reason: "",
      },
      {
        display: "CI/CD", canonical: "ci-cd", category: "Reliability & Release",
        evidenceStatus: "demonstrated_recent", claimIds: ["claim-release-checks"],
        supportingLocations: ["experience[0].bullets[2]"],
        targetRelevance: "high", depth: "material", decision: "include", reason: "",
      },
      {
        display: "Testing", canonical: "testing", category: "Reliability & Release",
        evidenceStatus: "demonstrated_recent", claimIds: ["claim-release-checks"],
        supportingLocations: ["experience[0].bullets[2]"],
        targetRelevance: "high", depth: "material", decision: "include", reason: "",
      },
    ],
  });
  assert.deepEqual(
    revalidateDependents({ skillsPlan, projectsPlan: null, resume: revised }).warnings,
    [],
  );

  /* -------------------------------------------------------- 7. release gate */
  const artifactHash = "a".repeat(64);
  const editorialBinding = {
    baselineHash: contract.sha256,
    editorialPlanHash: sha256(fs.readFileSync(planPath)),
    revisedContentHash: sha256(fs.readFileSync(resumePath)),
  };
  const release = ZReleaseOutput.parse(evaluateQualityGate({
    applicationStrategy: { status: "ready" },
    strategyValidation: { valid: true, issues: [] },
    claimValidation: { valid: true, issues: [] },
    artifactValidation: { valid: true, issues: [], artifactHash },
    atsResults: { ats: { hard_eligibility_missing: [], core_requirements_missing: [] } },
    atsJudge: { verdict: "pass", score: 82, metadata: {} },
    engineerJudge: { verdict: "advance_to_onsite", score: 88, metadata: {} },
    hrJudge: { screenRecommendation: "advance", score: 78, metadata: {}, visualReview: { reviewed: true } },
    expectedJudgeMetadata: { ats: {}, engineer: {}, hr: {} },
    artifactHash,
    artifactPath: "resume.docx",
    artifactType: "docx",
    editorialValidation,
    documentAudit,
    editorialBinding,
  }));

  assert.equal(release.state, "review_ready");
  assert.deepEqual(release.editorial, editorialBinding);
  // Advisory editorial findings are present and none of them is `unsupported`.
  const editorialFindings = release.findings.filter((finding) =>
    ["editorial", "document_audit"].includes(finding.source));
  assert.ok(editorialFindings.every((finding) => finding.status !== "unsupported"));
  for (const finding of release.findings) {
    assert.ok(finding.suggestedActions.length > 0, `${finding.code} has no route out of it`);
  }

  /* ------------------------------------------------- 8. the operator decides */
  const approval = ZReleaseApproval.parse({
    schemaVersion: "1.0",
    artifactHash,
    decision: "approved_by_operator",
    acceptedFindingIds: release.findings.map((finding) => finding.id),
    decidedAt: new Date().toISOString(),
    note: null,
    editorial: release.editorial,
  });
  assert.equal(approvalStatus(release, approval).approved, true);

  /* ------------------------------ 9. the baseline changes; approval goes stale */
  fs.writeFileSync(baselinePath, JSON.stringify({ ...baseline, ats_title: "Platform Engineer" }, null, 2));

  const rechecked = labora("baseline", application, "--check");
  assert.equal(rechecked.status, 2, "a changed baseline is reported, not ignored");
  assert.match(JSON.parse(rechecked.stdout).reason, /changed after it was recorded/);

  // And the plan written against the old bytes no longer describes anything.
  const revalidated = labora(
    "validate-editorial-plan", planPath, resumePath, claimsPath,
    "--application", application, "--accomplishments", bankPath,
  );
  assert.equal(revalidated.status, 2);
  assert.ok(JSON.parse(revalidated.stdout).issues.some((issue) => issue.code === "baseline_unusable"));

  const staleRelease = {
    ...release,
    editorial: { ...release.editorial, baselineHash: sha256(fs.readFileSync(baselinePath)) },
  };
  const status = approvalStatus(staleRelease, approval);
  assert.equal(status.approved, false);
  assert.match(status.reason, /approved baseline changed/);

  fs.rmSync(root, { recursive: true, force: true });
});

/* ----------------------------------------------------- required item 15 */

test("a run with no baseline behaves exactly as it did before", () => {
  const baseline = approvedBaseline();

  // No baseline view, no editorial plan, no section plans: the audit still runs
  // and still reports nothing that would change the existing workflow.
  const audit = auditDocument({ resume: baseline, jobSpec, claimLedger });
  assert.equal(audit.valid, true);
  assert.deepEqual(audit.issues, []);

  // The gate emits no editorial findings and a null binding, so an approval
  // recorded against it is indistinguishable from one recorded before any of
  // this existed.
  const artifactHash = "b".repeat(64);
  const release = ZReleaseOutput.parse(evaluateQualityGate({
    applicationStrategy: { status: "ready" },
    strategyValidation: { valid: true, issues: [] },
    claimValidation: { valid: true, issues: [] },
    artifactValidation: { valid: true, issues: [], artifactHash },
    atsResults: { ats: { hard_eligibility_missing: [], core_requirements_missing: [] } },
    atsJudge: { verdict: "pass", score: 82, metadata: {} },
    engineerJudge: { verdict: "advance_to_onsite", score: 88, metadata: {} },
    hrJudge: { screenRecommendation: "advance", score: 78, metadata: {}, visualReview: { reviewed: true } },
    expectedJudgeMetadata: { ats: {}, engineer: {}, hr: {} },
    artifactHash,
    artifactPath: "resume.docx",
    artifactType: "docx",
  }));

  assert.equal(release.editorial, null);
  assert.deepEqual(
    release.findings.filter((finding) => ["editorial", "document_audit", "cold_reader"].includes(finding.source)),
    [],
  );
  assert.equal(
    approvalStatus(release, {
      artifactHash,
      acceptedFindingIds: release.findings.map((finding) => finding.id),
    }).approved,
    true,
  );
});

test("an empty editorial plan against an unchanged document is valid and silent", () => {
  const baseline = approvedBaseline();
  const view = baselineEditorialView(baseline);
  const result = validateEditorialPlan({
    plan: ZEditorialPlan.parse({ ...emptyPlan, baselineHash: sha256(Buffer.from(JSON.stringify(baseline))) }),
    baselineView: view,
    revised: baseline,
    claimLedger,
    bank: accomplishmentBank,
    baselineApproved: true,
    baselineHash: sha256(Buffer.from(JSON.stringify(baseline))),
  });
  // Nothing changed, so nothing needs explaining. A baseline that demanded a
  // `keep` for every untouched span would make the plan a transcription
  // exercise and teach people to generate it mechanically.
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.coverage.changedLocations, []);
  assert.equal(result.reapproval.required, false);
});
