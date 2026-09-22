import test from "node:test";
import assert from "node:assert/strict";

import {
  revalidateDependents,
  validateExperiencePlan,
  validateProjectsPlan,
  validateSkillsPlan,
} from "../src/lib/section-plans.js";
import { ZExperiencePlan, ZProjectsPlan, ZSkillsPlan } from "../src/schemas/section-plans.js";
import { ZTailoredResume } from "../src/schemas/tailored-resume.js";

import { accomplishmentBank, approvedBaseline, claimLedger, withBullets } from "./fixtures/editorial.js";

const baseline = approvedBaseline();

/* ------------------------------------------------------------------ #108 */

function experiencePlan(overrides = {}) {
  return ZExperiencePlan.parse({
    schemaVersion: "1.0",
    roles: [{
      experienceId: "example-current",
      mission: "Prove architecture, production ownership, reliability and engineering leverage.",
      compression: "full",
      selected: [
        arc("unit-catalog", "reliability under partial dependency failure", "multi-source catalog pipeline",
          "designed and implemented", "concurrent retrieval with partial-result preservation",
          "kept producing usable results when individual sources failed", "sole_owner",
          ["claim-catalog-pipeline"], "experience[0].bullets[0]"),
        arc("unit-dashboard", "lifecycle ownership of a migration", "legacy dashboard",
          "led", "typed component architecture",
          "owned design, rollout and deprecation", "tech_lead",
          ["claim-dashboard-migration"], "experience[0].bullets[1]"),
      ],
      omitted: [{ unitId: "unit-review", reason: "The leverage purpose is already proved by the release checks." }],
    }],
    ...overrides,
  });
}

function arc(unitId, purpose, object, contribution, mechanism, consequence, attribution, claimIds, location) {
  return { unitId, purpose, object, contribution, mechanism, consequence, attribution, claimIds, location, readerContextRisks: [] };
}

test("a role whose bullets were chosen without a mission is reported", () => {
  const plan = experiencePlan();
  const ok = validateExperiencePlan({ plan, bank: accomplishmentBank, claimLedger, resume: baseline });
  assert.equal(ok.valid, true, JSON.stringify(ok.issues, null, 2));

  const missionless = ZExperiencePlan.parse({
    ...plan,
    roles: [{ ...plan.roles[0], mission: "  " }],
  });
  const result = validateExperiencePlan({ plan: missionless, bank: accomplishmentBank, claimLedger, resume: baseline });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "experience_role_has_no_mission"));
});

test("selection may narrow attribution but never strengthen it", () => {
  const inflated = ZExperiencePlan.parse({
    ...experiencePlan(),
    roles: [{
      ...experiencePlan().roles[0],
      selected: [
        // The bank records this unit as tech_lead. Claiming sole ownership of it
        // is the quiet upgrade that makes a shared result sound owned.
        arc("unit-dashboard", "lifecycle ownership", "legacy dashboard", "led", "typed components",
          "owned rollout", "sole_owner", ["claim-dashboard-migration"], "experience[0].bullets[1]"),
      ],
      omitted: [],
    }],
  });
  const result = validateExperiencePlan({ plan: inflated, bank: accomplishmentBank, claimLedger, resume: baseline });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "attribution_verb_mismatch"));
});

test("two arcs proving the same thing are reported as one wasted line", () => {
  const duplicated = ZExperiencePlan.parse({
    ...experiencePlan(),
    roles: [{
      ...experiencePlan().roles[0],
      selected: [
        arc("unit-catalog", "reliability under partial dependency failure", "catalog pipeline", "built",
          "partial results", "kept working when sources failed", "sole_owner", ["claim-catalog-pipeline"], "experience[0].bullets[0]"),
        arc("unit-release", "reliability under dependency partial failure", "release checks", "built",
          "regression evaluation", "gated every deploy", "sole_owner", ["claim-release-checks"], "experience[0].bullets[2]"),
      ],
      omitted: [],
    }],
  });
  const result = validateExperiencePlan({ plan: duplicated, bank: accomplishmentBank, claimLedger, resume: baseline });
  assert.ok(result.warnings.some((issue) => issue.code === "bullet_purpose_duplicate"));
});

test("an older role is compressed, not emptied", () => {
  const generic = ZExperiencePlan.parse({
    schemaVersion: "1.0",
    roles: [{
      experienceId: "example-prior",
      mission: "Establish product breadth and early delivery ownership.",
      compression: "foundational",
      selected: [
        arc("unit-intake", "customer-facing delivery", "contributed to multiple projects", "worked on",
          "", "contributed to multiple projects for clients", "major_contributor",
          ["claim-intake-forms"], "experience[1].bullets[0]"),
      ],
      omitted: [],
    }],
  });
  const result = validateExperiencePlan({ plan: generic, bank: accomplishmentBank, claimLedger, resume: baseline });
  assert.ok(result.warnings.some((issue) => issue.code === "older_role_generic_placeholder"));

  const concrete = ZExperiencePlan.parse({
    ...generic,
    roles: [{
      ...generic.roles[0],
      selected: [
        arc("unit-intake", "customer-facing delivery", "customer intake form flow", "built",
          "client-side validation and error recovery", "customers recovered from entry errors without support contact",
          "major_contributor", ["claim-intake-forms"], "experience[1].bullets[0]"),
      ],
    }],
  });
  assert.deepEqual(
    validateExperiencePlan({ plan: concrete, bank: accomplishmentBank, claimLedger, resume: baseline })
      .warnings.filter((issue) => issue.code === "older_role_generic_placeholder"),
    [],
  );
});

/* ------------------------------------------------------------------ #109 */

function skillsPlan(items) {
  return ZSkillsPlan.parse({
    schemaVersion: "1.0",
    model: "hybrid",
    modelReason: "Preserve concrete technologies while surfacing reliability and release depth.",
    categories: [
      { label: "Languages & Runtime", reason: "immediate retrieval of implementation languages", order: 1 },
      { label: "Reliability & Release", reason: "the capabilities the target role centres on", order: 2 },
    ],
    items,
  });
}

function skill(display, overrides = {}) {
  return {
    display,
    canonical: display.toLowerCase(),
    category: "Languages & Runtime",
    evidenceStatus: "demonstrated_recent",
    claimIds: ["claim-dashboard-migration"],
    supportingLocations: ["experience[0].bullets[1]"],
    targetRelevance: "high",
    depth: "material",
    decision: "include",
    reason: "",
    ...overrides,
  };
}

test("coursework is routed to Certifications rather than presented as experience", () => {
  const promoted = skillsPlan([
    skill("TypeScript"),
    skill("Example Cloud", {
      evidenceStatus: "formally_learned",
      claimIds: ["claim-cert-fundamentals"],
      supportingLocations: [],
      depth: "coursework",
      category: "Reliability & Release",
    }),
  ]);
  const result = validateSkillsPlan({ plan: promoted, claimLedger, resume: null });
  assert.equal(result.valid, false);
  const issue = result.issues.find((entry) => entry.code === "course_promoted_to_production_skill");
  assert.ok(issue);
  assert.match(issue.message, /Certifications says the true thing/);
  assert.equal(issue.route, "move");

  const routed = skillsPlan([
    skill("TypeScript"),
    skill("Example Cloud", {
      evidenceStatus: "formally_learned",
      claimIds: ["claim-cert-fundamentals"],
      supportingLocations: [],
      depth: "coursework",
      decision: "certifications_only",
      reason: "Fundamentals coursework, not production platform experience.",
    }),
  ]);
  assert.equal(validateSkillsPlan({ plan: routed, claimLedger, resume: null }).valid, true);
});

test("behavioural traits and umbrella words are kept out of Technical Skills", () => {
  const traits = skillsPlan([
    skill("TypeScript"),
    skill("Teamwork", { category: "Reliability & Release" }),
    skill("Cloud", { category: "Reliability & Release" }),
    skill("Advanced React", { category: "Reliability & Release" }),
  ]);
  const codes = validateSkillsPlan({ plan: traits, claimLedger, resume: null })
    .warnings.map((issue) => issue.code);
  assert.ok(codes.includes("soft_skill_without_proof"));
  assert.ok(codes.includes("skill_term_too_generic"));
  assert.ok(codes.includes("proficiency_scale_undefined"));
});

test("a one-item category is a heading pretending to be a taxonomy", () => {
  const lopsided = skillsPlan([
    skill("TypeScript"),
    skill("Node.js"),
    skill("CI/CD", { category: "Reliability & Release", claimIds: ["claim-release-checks"], supportingLocations: ["experience[0].bullets[2]"] }),
  ]);
  assert.ok(
    validateSkillsPlan({ plan: lopsided, claimLedger, resume: null })
      .warnings.some((issue) => issue.code === "category_granularity_mismatch"),
  );
});

/* ------------------------------------------------------------------ #110 */

function projectsPlan(selected, overrides = {}) {
  return ZProjectsPlan.parse({
    schemaVersion: "1.0",
    sectionTitle: "Open Source & Projects",
    selectionMission: "Add inspectable product and developer-tooling proof.",
    selected,
    omitted: [],
    omittedSectionReason: "",
    ...overrides,
  });
}

const atlas = {
  displayName: "Example Atlas",
  descriptor: "Route-Planning Application",
  artifactKind: "live_product_private_source",
  canonicalUrl: "https://example.invalid/atlas",
  proofMission: "end-to-end live product ownership",
  ownership: "built end to end",
  readerValue: "builds accessible itineraries without requiring an account",
  engineeringProof: ["shared validation contracts", "telemetry", "automated tests"],
  statusClaims: ["live", "private_source"],
  sourceVisibility: "private",
  claimIds: ["claim-atlas-project"],
  verifiedAt: "2026-01-02T00:00:00Z",
  order: 1,
};

const coordkit = {
  displayName: "coord-kit",
  descriptor: "Workflow record CLI",
  artifactKind: "open_source_cli",
  canonicalUrl: "https://example.invalid/coord-kit",
  proofMission: "open-source developer tooling",
  ownership: "maintainer",
  readerValue: "records and replays workflow decisions from the command line",
  engineeringProof: ["content-addressed records"],
  statusClaims: ["open_source"],
  sourceVisibility: "public",
  claimIds: ["claim-coordkit-project"],
  verifiedAt: "2026-01-02T00:00:00Z",
  order: 2,
};

test("a live product with private source may not be labelled open source", () => {
  assert.equal(validateProjectsPlan({ plan: projectsPlan([atlas, coordkit]), claimLedger }).valid, true);

  const mislabelled = projectsPlan([{ ...atlas, statusClaims: ["live", "open_source"] }, coordkit]);
  const result = validateProjectsPlan({ plan: mislabelled, claimLedger });
  assert.equal(result.valid, false);
  const issue = result.issues.find((entry) => entry.code === "project_source_visibility_mismatch");
  assert.ok(issue);
  assert.match(issue.message, /go looking for code they cannot see/);
});

test("release and installation status need their own evidence", () => {
  const overclaimed = projectsPlan([
    { ...coordkit, statusClaims: ["open_source", "released", "installable"], claimIds: [] },
  ]);
  const result = validateProjectsPlan({ plan: overclaimed, claimLedger });
  assert.equal(result.valid, false);
  const issue = result.issues.find((entry) => entry.code === "project_status_overclaim");
  assert.match(issue.message, /Prepared package metadata is not a release/);
});

test("the section title describes the set that was actually selected", () => {
  const privateOnly = projectsPlan([atlas]);
  assert.ok(
    validateProjectsPlan({ plan: privateOnly, claimLedger })
      .warnings.some((issue) => issue.code === "project_section_title_mismatch"),
  );
  const retitled = projectsPlan([atlas], { sectionTitle: "Selected Projects" });
  assert.deepEqual(
    validateProjectsPlan({ plan: retitled, claimLedger })
      .warnings.filter((issue) => issue.code === "project_section_title_mismatch"),
    [],
  );
});

test("two projects proving the same thing spend a line for nothing", () => {
  const redundant = projectsPlan([atlas, { ...coordkit, proofMission: "end-to-end live product ownership" }]);
  assert.ok(
    validateProjectsPlan({ plan: redundant, claimLedger })
      .warnings.some((issue) => issue.code === "project_without_proof_mission"),
  );
});

/* ------------------------------------------------------ required item 14 */

test("removing the bullet that proved a skill invalidates the skill", () => {
  const plan = skillsPlan([
    skill("TypeScript", { supportingLocations: ["experience[0].bullets[1]"] }),
    skill("CI/CD", {
      category: "Reliability & Release",
      claimIds: ["claim-release-checks"],
      supportingLocations: ["experience[0].bullets[2]"],
    }),
    skill("Testing", {
      category: "Reliability & Release",
      claimIds: ["claim-release-checks"],
      supportingLocations: ["experience[0].bullets[2]"],
    }),
  ]);

  // While the proof is rendered, nothing is stale.
  const intact = revalidateDependents({ skillsPlan: plan, projectsPlan: null, resume: baseline });
  assert.deepEqual(intact.warnings, []);

  // Cut the release-checks bullet for space. Both skills that leaned on it lose
  // their visible proof, while the claim ledger still supports them -- which is
  // exactly why no other validator notices.
  const trimmed = withBullets(baseline, "example-current", [
    baseline.experience[0].bullets[0],
    baseline.experience[0].bullets[1],
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"]]);

  const stale = revalidateDependents({ skillsPlan: plan, projectsPlan: null, resume: trimmed });
  const codes = stale.warnings.map((issue) => issue.code);
  assert.equal(codes.filter((code) => code === "skill_dependency_stale").length, 2, JSON.stringify(stale.warnings, null, 2));
  assert.match(stale.warnings[0].message, /claim ledger still supports it; this document no longer shows it/);

  // The verified claim is untouched. Only the document's visible proof changed.
  assert.ok(claimLedger.claims.some((entry) => entry.id === "claim-release-checks" && entry.status === "verified"));
});

test("dropping a project invalidates the skills that only it proved", () => {
  const withProject = ZTailoredResume.parse({
    ...baseline,
    projects: [{
      name: "coord-kit",
      description: "Workflow record CLI.",
      highlights: [],
      link: "https://example.invalid/coord-kit",
      claimIds: ["claim-coordkit-project"],
    }],
  });

  const plan = skillsPlan([
    skill("Go", {
      category: "Reliability & Release",
      evidenceStatus: "demonstrated_project",
      claimIds: ["claim-coordkit-project"],
      supportingLocations: ["projects[0].description"],
    }),
    skill("TypeScript"),
  ]);
  const projects = projectsPlan([coordkit], { sectionTitle: "Open Source & Projects" });

  assert.deepEqual(
    revalidateDependents({ skillsPlan: plan, projectsPlan: projects, resume: withProject }).warnings,
    [],
  );

  const withoutProject = ZTailoredResume.parse({ ...baseline, projects: [] });
  const stale = revalidateDependents({ skillsPlan: plan, projectsPlan: projects, resume: withoutProject });
  const codes = stale.warnings.map((issue) => issue.code);
  assert.ok(codes.includes("skill_dependency_stale"));
  assert.ok(codes.includes("project_dependency_stale"));
});
