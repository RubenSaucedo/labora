import { z } from "zod";

/**
 * Intermediate section plans.
 *
 * Each of #108, #109 and #110 asks for the same thing in a different section:
 * make *selection* inspectable before prose exists. A finished bullet hides the
 * decision that produced it, so a reviewer can only argue with the sentence,
 * never with the choice of which of eight supportable accomplishments earned
 * the space.
 *
 * These schemas deliberately share vocabulary -- `purpose`, `proofMission`,
 * `claimIds`, `supportingLocations` -- because the dependency between them is
 * real: a skill is only listed because some bullet or project proves it, and
 * removing that proof has to invalidate the skill.
 */

const ZClaimIds = z.array(z.string().min(1)).default([]);

/* ------------------------------------------------------------------ #108 */

export const ZAccomplishmentArc = z.object({
  unitId: z.string().min(1),
  // What this bullet is *for* in the section. Two bullets with the same purpose
  // are one bullet and one wasted line, however different their nouns.
  purpose: z.string().min(1),
  // The arc: object, contribution, mechanism, consequence. Not every field is
  // required in the rendered sentence; all four are required in the plan, so
  // that omitting one is a decision rather than an oversight.
  object: z.string().min(1),
  contribution: z.string().min(1),
  mechanism: z.string().default(""),
  consequence: z.string().min(1),
  attribution: z.enum([
    "sole_owner",
    "tech_lead",
    "major_contributor",
    "contributor",
    "reviewer",
  ]),
  claimIds: ZClaimIds,
  // Where this arc is rendered, so skills and projects can depend on it.
  location: z.string().default(""),
  readerContextRisks: z.array(z.string()).default([]),
}).strict();

export const ZExperiencePlan = z.object({
  schemaVersion: z.literal("1.0"),
  roles: z.array(z.object({
    experienceId: z.string().min(1),
    // What this role proves in the career story. Without it every employer gets
    // the same generic action-plus-tool bullets.
    mission: z.string().min(1),
    // How much space the role earns. `foundational` means compressed, not
    // emptied: an older role keeps one concrete system rather than becoming
    // "contributed to multiple projects".
    compression: z.enum(["full", "concise", "foundational"]).default("full"),
    selected: z.array(ZAccomplishmentArc).default([]),
    omitted: z.array(z.object({
      unitId: z.string().min(1),
      reason: z.string().min(1),
    }).strict()).default([]),
  }).strict()).default([]),
}).strict();

/* ------------------------------------------------------------------ #109 */

/**
 * How a skill came to be believed. These are not confidence levels; they are
 * different *kinds* of support that need different treatment. Coursework is not
 * weak production experience, it is a different thing, and routing it to
 * Certifications is the honest rendering rather than a demotion.
 */
export const SKILL_EVIDENCE_STATUSES = [
  "demonstrated_recent",
  "demonstrated_older",
  "demonstrated_project",
  "formally_learned",
  "exposure_only",
  "unsupported",
];

export const SKILL_CATEGORY_MODELS = ["technology", "capability", "hybrid"];

export const ZSkillsPlan = z.object({
  schemaVersion: z.literal("1.0"),
  model: z.enum(SKILL_CATEGORY_MODELS),
  // Chosen, not defaulted. The hybrid model suits many experienced engineers
  // and is exactly the one most likely to be selected without thinking.
  modelReason: z.string().min(1),
  categories: z.array(z.object({
    label: z.string().min(1),
    reason: z.string().min(1),
    order: z.number().int().min(1),
  }).strict()).default([]),
  items: z.array(z.object({
    display: z.string().min(1),
    canonical: z.string().min(1),
    category: z.string().default(""),
    evidenceStatus: z.enum(SKILL_EVIDENCE_STATUSES),
    claimIds: ZClaimIds,
    // Resume locations that visibly prove this item. The dependency edge: when
    // the last one disappears, the skill is stale rather than merely unproved.
    supportingLocations: z.array(z.string()).default([]),
    targetRelevance: z.enum(["high", "medium", "low", "none"]).default("medium"),
    depth: z.enum(["material", "incidental", "coursework", "none"]).default("material"),
    decision: z.enum(["include", "exclude", "certifications_only", "education_only"]),
    reason: z.string().default(""),
  }).strict()).default([]),
}).strict();

/* ------------------------------------------------------------------ #110 */

export const PROJECT_ARTIFACT_KINDS = [
  "live_product_public_source",
  "live_product_private_source",
  "open_source_library",
  "open_source_cli",
  "open_source_plugin",
  "contribution",
  "prototype",
];

export const PROJECT_SECTION_TITLES = ["Projects", "Selected Projects", "Open Source & Projects"];

export const ZProjectsPlan = z.object({
  schemaVersion: z.literal("1.0"),
  // Chosen from the selected set, not fixed. Labelling a section "Open Source"
  // when one selected artifact is not open source misdescribes the set.
  sectionTitle: z.enum(PROJECT_SECTION_TITLES),
  selectionMission: z.string().min(1),
  selected: z.array(z.object({
    displayName: z.string().min(1),
    descriptor: z.string().default(""),
    artifactKind: z.enum(PROJECT_ARTIFACT_KINDS),
    canonicalUrl: z.string().default(""),
    // One primary job in the complete resume. Two projects proving the same
    // thing means one of them is spending space for nothing.
    proofMission: z.string().min(1),
    ownership: z.string().min(1),
    readerValue: z.string().min(1),
    engineeringProof: z.array(z.string()).default([]),
    // Only what the evidence establishes. A reachable URL proves reachability.
    statusClaims: z.array(z.enum([
      "live", "open_source", "private_source", "released", "installable",
      "maintained", "prototype", "archived",
    ])).default([]),
    sourceVisibility: z.enum(["public", "private", "unknown"]).default("unknown"),
    claimIds: ZClaimIds,
    // When the canonical identity was last confirmed against the live surface.
    verifiedAt: z.string().default(""),
    order: z.number().int().min(1),
  }).strict()).default([]),
  omitted: z.array(z.object({
    displayName: z.string().min(1),
    reason: z.string().min(1),
  }).strict()).default([]),
  // Recorded when the section is deliberately absent, so "no Projects section"
  // is a decision with a reason rather than a gap.
  omittedSectionReason: z.string().default(""),
}).strict();
