import test from "node:test";
import assert from "node:assert/strict";

import {
  SECTION_MISSIONS,
  borrowedTermIssues,
  evaluateSectionMissions,
  keywordPlacementIssues,
  summaryAltitudeIssues,
} from "../src/lib/section-missions.js";
import { auditDocument } from "../src/lib/document-audit.js";
import { validateSkillsPlan } from "../src/lib/section-plans.js";
import { baselineEditorialView, sha256 } from "../src/lib/editorial-baseline.js";
import { ZTailoredResume } from "../src/schemas/tailored-resume.js";

import {
  approvedBaseline,
  claimLedger,
  jobSpec,
  withSummarySentences,
} from "./fixtures/editorial.js";

/**
 * Summary altitude, placement, and vocabulary borrowed from a posting.
 *
 * Every defect below is *supported*. That is what makes it hard: claim
 * validation passes, the sentence is true, and the document is worse because
 * the true thing is in the wrong place or bought nothing.
 */

const baseline = approvedBaseline();
const view = baselineEditorialView(baseline);

/* ------------------------------------------------------- required item 4 */

test("a mechanism inventory in the summary is reported as misplaced, not as bad prose", () => {
  const inventory =
    "Recent work includes TypeScript services, GraphQL contracts, Docker packaging, and CI/CD pipelines.";
  const revised = withSummarySentences(
    baseline,
    [baseline.provenance.summary[0].text, inventory],
    [
      { claimIds: ["claim-tenure"], unitIds: [] },
      { claimIds: ["claim-catalog-pipeline", "claim-release-checks"], unitIds: ["unit-catalog"] },
    ],
  );

  const issues = summaryAltitudeIssues({ resume: revised, baselineView: view });
  const inventoryIssue = issues.find((issue) => issue.code === "summary_mechanism_inventory");

  assert.ok(inventoryIssue, JSON.stringify(issues, null, 2));
  assert.equal(inventoryIssue.location, "summary.sentences[1]");
  // The operation matters more than the finding: the repair is to relocate the
  // content, not to write a nicer sentence containing the same inventory.
  assert.equal(inventoryIssue.route, "move");
  assert.deepEqual(inventoryIssue.suggestedDestinations, ["skills", "experience"]);
  assert.match(SECTION_MISSIONS.summary.mission, /Interpret the career/);
});

test("polishing a misplaced summary in place is reported as the wrong operation", () => {
  const inventory =
    "Recent work includes TypeScript services, GraphQL contracts, Docker packaging, and CI/CD pipelines.";
  const revised = withSummarySentences(
    baseline,
    [baseline.provenance.summary[0].text, inventory],
    [
      { claimIds: ["claim-tenure"], unitIds: [] },
      { claimIds: ["claim-catalog-pipeline", "claim-release-checks"], unitIds: ["unit-catalog"] },
    ],
  );

  const audit = auditDocument({
    resume: revised,
    baselineView: view,
    jobSpec,
    claimLedger,
    editorialPlan: {
      operations: [{
        location: "summary.sentences[1]",
        operation: "rewrite",
        semanticDelta: "none",
        reason: "tighten the phrasing",
      }],
    },
  });

  const misses = audit.warnings.filter((entry) => entry.code === "local_polish_architecture_miss");
  assert.ok(misses.length > 0, JSON.stringify(audit.warnings, null, 2));
  assert.ok(misses.every((entry) => entry.location === "summary.sentences[1]"));
  // Both repairs are reported: relocate the inventory, and drop the term the
  // document already carries. Reporting only one hides half the work.
  assert.ok(misses.some((entry) => entry.route === "move"));
  assert.ok(misses.some((entry) => entry.route === "delete"));
});

test("raising altitude is preferred over stacking a qualifier on an ambiguous term", () => {
  const ambiguous = "Built a response-synthesis layer for the catalog request path.";
  const withBaseline = withSummarySentences(
    baseline,
    [baseline.provenance.summary[0].text, ambiguous],
    [
      { claimIds: ["claim-tenure"], unitIds: [] },
      { claimIds: ["claim-catalog-pipeline"], unitIds: ["unit-catalog"] },
    ],
  );
  const ambiguousView = baselineEditorialView(withBaseline);

  // The repair that narrows the term but leaves it at the wrong altitude.
  const qualified = withSummarySentences(
    withBaseline,
    [
      baseline.provenance.summary[0].text,
      "Built a text-based response-synthesis layer for the catalog request path using TypeScript.",
    ],
    [
      { claimIds: ["claim-tenure"], unitIds: [] },
      { claimIds: ["claim-catalog-pipeline"], unitIds: ["unit-catalog"] },
    ],
  );

  const stacked = summaryAltitudeIssues({ resume: qualified, baselineView: ambiguousView });
  assert.ok(
    stacked.some((issue) => issue.code === "summary_qualifier_stacked_on_ambiguous_term"),
    JSON.stringify(stacked, null, 2),
  );

  // The altitude repair -- supported professional scope -- raises no finding.
  const raised = withSummarySentences(
    withBaseline,
    [
      baseline.provenance.summary[0].text,
      "Led catalog platform work from architecture through production.",
    ],
    [
      { claimIds: ["claim-tenure"], unitIds: [] },
      { claimIds: ["claim-dashboard-migration"], unitIds: ["unit-dashboard"] },
    ],
  );
  assert.deepEqual(summaryAltitudeIssues({ resume: raised, baselineView: ambiguousView }), []);
});

/* ------------------------------------------------------- required item 5 */

test("a posting keyword already carried elsewhere is not duplicated into the summary", () => {
  const duplicated = withSummarySentences(
    baseline,
    [
      baseline.provenance.summary[0].text,
      "Led platform work from architecture through production, including Docker packaging of the service tier.",
    ],
    [
      { claimIds: ["claim-tenure"], unitIds: [] },
      { claimIds: ["claim-catalog-pipeline"], unitIds: ["unit-catalog"] },
    ],
  );

  const issues = keywordPlacementIssues({ resume: duplicated, jobSpec, baselineView: view });
  const regression = issues.find((issue) => issue.code === "keyword_placement_regression");
  assert.ok(regression, JSON.stringify(issues, null, 2));
  assert.match(regression.message, /docker/i);
  assert.match(regression.message, /already carried accurately at skills\.secondary\[1\]/);

  // The approved summary, unchanged, buys no finding at all.
  assert.deepEqual(keywordPlacementIssues({ resume: baseline, jobSpec, baselineView: view }), []);
});

test("a term the operator deliberately put in the approved summary is left alone", () => {
  // Intentional repetition is legitimate. The signal that separates it from
  // coverage-chasing is that a person chose it, which the baseline records.
  const deliberate = withSummarySentences(
    baseline,
    [
      "Software engineer with seven years of experience across TypeScript products and backend services.",
      baseline.provenance.summary[1].text,
    ],
    [
      { claimIds: ["claim-tenure"], unitIds: [] },
      { claimIds: ["claim-dashboard-migration", "claim-release-checks"], unitIds: ["unit-dashboard", "unit-release"] },
    ],
  );
  const deliberateView = baselineEditorialView(deliberate);
  const issues = keywordPlacementIssues({ resume: deliberate, jobSpec, baselineView: deliberateView });
  assert.deepEqual(issues.filter((issue) => /typescript/i.test(issue.message)), []);
});

test("a technology that is the target specialisation is not generalised away", () => {
  // Raising altitude is not a licence to vague. When the technology *is* the
  // professional identity, naming it in the Summary is the correct altitude,
  // and generalising it away would remove the thing the resume leads with.
  const specialised = withSummarySentences(
    baseline,
    [
      "TypeScript platform engineer with seven years across service and web layers.",
      baseline.provenance.summary[1].text,
    ],
    [
      { claimIds: ["claim-tenure", "claim-dashboard-migration"], unitIds: ["unit-dashboard"] },
      { claimIds: ["claim-dashboard-migration", "claim-release-checks"], unitIds: ["unit-dashboard", "unit-release"] },
    ],
  );

  const issues = summaryAltitudeIssues({ resume: specialised, baselineView: view });
  assert.deepEqual(
    issues.filter((issue) => issue.code === "summary_mechanism_inventory"),
    [],
    "one central technology inside a sentence about professional identity is not an inventory",
  );

  // And the placement check does not ask for it to be dropped either, because
  // it changes how the reader classifies the candidate rather than merely
  // repeating a retrieval term.
  const placement = keywordPlacementIssues({ resume: specialised, jobSpec, baselineView: view });
  const removal = placement.find((issue) => /typescript/i.test(issue.message) && issue.route === "delete");
  assert.ok(removal, "the check still reports it, because only a human can decide identity from coverage");
  assert.match(removal.message, /buys retrieval coverage the document already has/);
  assert.equal(removal.severity, "warning", "it is advice, never a removal the tool performs");
});

/* ------------------------------------------------------ required item 12 */

test("unsupported posting vocabulary is never adopted into prose", () => {
  const borrowedSentence =
    "Led real-time platform work at scale in Python across the organisation.";
  const borrowed = withSummarySentences(
    baseline,
    [baseline.provenance.summary[0].text, borrowedSentence],
    [
      { claimIds: ["claim-tenure"], unitIds: [] },
      { claimIds: ["claim-dashboard-migration"], unitIds: ["unit-dashboard"] },
    ],
  );

  const issues = borrowedTermIssues({ resume: borrowed, jobSpec, claimLedger, baselineView: view });
  assert.ok(issues.every((issue) => issue.code === "unsupported_posting_term_added"));

  const messages = issues.map((issue) => issue.message).join("\n");
  assert.match(messages, /real-time/);
  assert.match(messages, /at scale/);
  assert.match(messages, /python/i);

  // This crosses an evidence boundary, so it is an error rather than advice --
  // and the message still reports a fact about the corpus, not about the person.
  const evaluated = evaluateSectionMissions({ resume: borrowed, jobSpec, claimLedger, baselineView: view });
  assert.equal(evaluated.valid, false);
  assert.match(messages, /arrived as vocabulary rather than as evidence|says nothing about whether the candidate knows it/);
});

test("an unsupported posting term in Skills is owned by the skills plan, not re-decided here", () => {
  // Whether a listed skill is supported is already decided by claim validation
  // against the facts its provenance maps to. Deciding it twice, with a cruder
  // test, would produce a second answer that disagrees with the better one.
  const withPythonSkill = ZTailoredResume.parse({
    ...baseline,
    skills_primary: [...baseline.skills_primary, "Python"],
    provenance: {
      ...baseline.provenance,
      skills: [...baseline.provenance.skills, { skill: "Python", claimIds: ["claim-catalog-pipeline"] }],
    },
  });
  assert.deepEqual(
    borrowedTermIssues({ resume: withPythonSkill, jobSpec, claimLedger, baselineView: view }),
    [],
  );

  const plan = validateSkillsPlan({
    plan: {
      schemaVersion: "1.0",
      model: "hybrid",
      modelReason: "Preserve concrete technologies alongside reliability capabilities.",
      categories: [
        { label: "Languages & Runtime", reason: "immediate retrieval of implementation languages", order: 1 },
      ],
      items: [
        {
          display: "Python", canonical: "python", category: "Languages & Runtime",
          evidenceStatus: "unsupported", claimIds: [], supportingLocations: [],
          targetRelevance: "high", depth: "none", decision: "include", reason: "",
        },
        {
          display: "TypeScript", canonical: "typescript", category: "Languages & Runtime",
          evidenceStatus: "demonstrated_recent", claimIds: ["claim-dashboard-migration"],
          supportingLocations: ["experience[0].bullets[1]"],
          targetRelevance: "high", depth: "material", decision: "include", reason: "",
        },
      ],
    },
    claimLedger,
  });
  assert.equal(plan.valid, false);
  assert.ok(plan.issues.some((issue) => issue.code === "skill_without_evidence"));
});

test("supported posting vocabulary is not disturbed", () => {
  // TypeScript and CI/CD are required by the posting and carried by verified
  // claims. Nothing here may report them.
  const issues = borrowedTermIssues({ resume: baseline, jobSpec, claimLedger, baselineView: view });
  assert.deepEqual(issues, []);
});

test("the baseline hash is what binds a placement comparison", () => {
  assert.equal(sha256(Buffer.from(JSON.stringify(baseline), "utf8")).length, 64);
  assert.equal(view.segments.every((segment) => segment.hash.length === 64), true);
});
