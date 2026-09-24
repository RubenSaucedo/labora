import { indexSegments, segmentResume, significantTokens } from "./resume-segments.js";
import { NON_TECHNICAL_TRAITS, GENERIC_UMBRELLA_TERMS, PROFICIENCY_MARKERS } from "./section-missions.js";

/**
 * Validating the section plans.
 *
 * These checks are about *selection*, which is the judgment claim validation
 * cannot reach. A role whose bullets were generated without deciding what the
 * role proves will produce eight supportable sentences that say nothing about
 * level. A skills list assembled from every supported tag is a tag dump. A
 * projects section with two entries proving the same thing has spent a line for
 * nothing.
 *
 * Most of what follows is advisory, because selection is editorial. The
 * exceptions are the ones that cross an evidence boundary: listing a skill with
 * no support, presenting coursework as production experience, or claiming a
 * release, adoption or public-source status the evidence does not establish.
 */

function issue(severity, code, location, message, route = "") {
  return { severity, code, location, message, route };
}

const GENERIC_ROLE_PHRASES = [
  "contributed to multiple projects",
  "worked on various",
  "responsible for",
  "involved in",
  "participated in",
  "assisted with various",
];

export function validateExperiencePlan({ plan, bank = null, claimLedger = null, resume = null }) {
  const issues = [];
  const units = new Map((bank?.units || []).map((unit) => [unit.id, unit]));
  const verified = new Set(
    (claimLedger?.claims || []).filter((claim) => claim.status === "verified").map((claim) => claim.id)
  );
  const renderedIds = new Set((resume?.experience || []).map((role) => role.id).filter(Boolean));

  const purposesGlobal = new Map();

  for (const role of plan?.roles || []) {
    const where = `experience:${role.experienceId}`;

    if (resume && renderedIds.size && !renderedIds.has(role.experienceId)) {
      issues.push(issue(
        "warning",
        "experience_plan_role_unrendered",
        where,
        `The plan covers role "${role.experienceId}", which the resume does not render.`,
      ));
    }
    if (!role.mission.trim()) {
      issues.push(issue(
        "error",
        "experience_role_has_no_mission",
        where,
        "Bullets were selected without stating what this role proves in the career story.",
      ));
    }

    const purposes = new Map();
    for (const arc of role.selected || []) {
      const at = arc.location || `${where}:${arc.unitId}`;

      if (units.size && !units.has(arc.unitId)) {
        issues.push(issue("error", "unknown_unit", at, `Unit "${arc.unitId}" is not in the accomplishment bank.`));
      }
      for (const claimId of arc.claimIds) {
        if (verified.size && !verified.has(claimId)) {
          issues.push(issue("error", "unverified_claim", at, `Claim "${claimId}" is not verified in the current ledger.`));
        }
      }
      // Attribution may only ever narrow relative to the bank. Selecting a
      // stronger contribution verb than the unit records is the quiet way a
      // shared result becomes an owned one.
      const unit = units.get(arc.unitId);
      if (unit) {
        const order = ["reviewer", "contributor", "major_contributor", "tech_lead", "sole_owner"];
        if (order.indexOf(arc.attribution) > order.indexOf(unit.contribution)) {
          issues.push(issue(
            "error",
            "attribution_verb_mismatch",
            at,
            `The plan claims "${arc.attribution}" for a unit recorded as "${unit.contribution}".`,
            "rewrite",
          ));
        }
      }

      if (!arc.consequence.trim()) {
        issues.push(issue(
          "warning",
          "mechanism_without_consequence",
          at,
          "The arc records a mechanism and no consequence, so the reader learns what was done and not what changed.",
          "make_specific",
        ));
      }

      const key = normalizePurpose(arc.purpose);
      if (purposes.has(key)) {
        issues.push(issue(
          "warning",
          "bullet_purpose_duplicate",
          at,
          `This arc proves the same thing as ${purposes.get(key)} ("${arc.purpose}"). Different technologies do ` +
          "not make two bullets serve different purposes.",
          "delete",
        ));
      } else {
        purposes.set(key, at);
      }
      if (purposesGlobal.has(key) && purposesGlobal.get(key).role !== role.experienceId) {
        issues.push(issue(
          "info",
          "bullet_purpose_duplicate",
          at,
          `This arc repeats the purpose already proved at ${purposesGlobal.get(key).at}, under a different role. ` +
          "Repetition across roles can show progression; check that it does here.",
        ));
      } else if (!purposesGlobal.has(key)) {
        purposesGlobal.set(key, { at, role: role.experienceId });
      }
    }

    for (const omitted of role.omitted || []) {
      if (!omitted.reason.trim()) {
        issues.push(issue("error", "omission_without_reason", where, `Unit "${omitted.unitId}" was dropped with no reason.`));
      }
    }

    // #108 rule 10: an older role receives less space, not less meaning.
    if (role.compression === "foundational") {
      const arcs = role.selected || [];
      if (!arcs.length) {
        issues.push(issue(
          "warning",
          "older_role_generic_placeholder",
          where,
          "A compressed role with no selected accomplishment becomes a date range with a job title.",
          "make_specific",
        ));
      }
      for (const arc of arcs) {
        const text = `${arc.object} ${arc.consequence}`.toLowerCase();
        if (GENERIC_ROLE_PHRASES.some((phrase) => text.includes(phrase))) {
          issues.push(issue(
            "warning",
            "older_role_generic_placeholder",
            arc.location || where,
            "The compressed arc reads as a responsibility description rather than one concrete system or problem.",
            "make_specific",
          ));
        }
      }
    }
  }

  return finish(issues);
}

function normalizePurpose(value) {
  return significantTokens(value).sort().join(" ");
}

export function validateSkillsPlan({ plan, claimLedger = null, resume = null }) {
  const issues = [];
  const verified = new Set(
    (claimLedger?.claims || []).filter((claim) => claim.status === "verified").map((claim) => claim.id)
  );
  const categories = new Map((plan?.categories || []).map((entry) => [entry.label, entry]));
  const perCategory = new Map();
  const canonicalSeen = new Map();

  const rendered = new Set([...(resume?.skills_primary || []), ...(resume?.skills_secondary || [])]);

  for (const item of plan?.items || []) {
    const at = `skills:${item.display}`;
    const included = item.decision === "include";

    if (included) {
      if (item.evidenceStatus === "unsupported") {
        issues.push(issue(
          "error",
          "skill_without_evidence",
          at,
          `"${item.display}" is listed with no supporting claim, project, credential or operator source.`,
          "delete",
        ));
      }
      if (item.evidenceStatus === "formally_learned") {
        issues.push(issue(
          "error",
          "course_promoted_to_production_skill",
          at,
          `"${item.display}" is supported only by coursework or a credential. Listing it under Technical Skills ` +
          "presents formal learning as demonstrated experience; Certifications says the true thing.",
          "move",
        ));
      }
      if (item.evidenceStatus === "exposure_only") {
        issues.push(issue(
          "warning",
          "skill_exposure_only",
          at,
          `"${item.display}" was used incidentally without meaningful ownership.`,
          "delete",
        ));
      }
      for (const claimId of item.claimIds) {
        if (verified.size && !verified.has(claimId)) {
          issues.push(issue("error", "unverified_claim", at, `"${item.display}" cites unverified claim "${claimId}".`));
        }
      }
      if (item.category && categories.size && !categories.has(item.category)) {
        issues.push(issue("warning", "skill_category_mismatch", at, `"${item.display}" sits in undeclared category "${item.category}".`));
      }
      if (item.category) perCategory.set(item.category, (perCategory.get(item.category) || 0) + 1);

      if (NON_TECHNICAL_TRAITS.includes(item.display.toLowerCase())) {
        issues.push(issue("warning", "soft_skill_without_proof", at, `"${item.display}" is a behavioural trait, not retrievable technical vocabulary.`, "move"));
      }
      if (GENERIC_UMBRELLA_TERMS.includes(item.display.toLowerCase())) {
        issues.push(issue("warning", "skill_term_too_generic", at, `"${item.display}" names a discipline rather than a searchable capability.`, "make_specific"));
      }
      if (PROFICIENCY_MARKERS.test(item.display)) {
        issues.push(issue("warning", "proficiency_scale_undefined", at, `"${item.display}" asserts a level with no shared basis.`, "rewrite"));
      }

      const key = item.canonical.toLowerCase();
      if (canonicalSeen.has(key)) {
        issues.push(issue(
          "warning",
          "keyword_stuffing_visible",
          at,
          `"${item.display}" and "${canonicalSeen.get(key)}" normalise to the same term. Repetition here serves ` +
          "a scoring theory rather than a reader.",
          "delete",
        ));
      } else {
        canonicalSeen.set(key, item.display);
      }

      if (resume && rendered.size && !rendered.has(item.display)) {
        issues.push(issue("warning", "skills_plan_item_unrendered", at, `"${item.display}" is planned for inclusion but the resume does not render it.`));
      }
    }

    if (!included && !item.reason.trim()) {
      issues.push(issue("warning", "skill_decision_without_reason", at, `"${item.display}" was ${item.decision} with no recorded reason.`));
    }
  }

  for (const [label, count] of perCategory) {
    if (count === 1) {
      issues.push(issue(
        "warning",
        "category_granularity_mismatch",
        `skills:${label}`,
        `Category "${label}" holds one item. A one-item bucket is a heading pretending to be a taxonomy.`,
      ));
    }
  }
  if (plan && !plan.modelReason?.trim()) {
    issues.push(issue("warning", "skill_model_not_chosen", "skills", "The category model was applied without a recorded reason for choosing it."));
  }

  return finish(issues);
}

const OVERCLAIMED_STATUSES = ["released", "installable", "maintained"];

export function validateProjectsPlan({ plan, claimLedger = null, resume = null }) {
  const issues = [];
  const verified = new Set(
    (claimLedger?.claims || []).filter((claim) => claim.status === "verified").map((claim) => claim.id)
  );
  const missions = new Map();
  const renderedNames = new Set((resume?.projects || []).map((project) => project.name).filter(Boolean));

  for (const project of plan?.selected || []) {
    const at = `projects:${project.displayName}`;

    if (!project.proofMission.trim()) {
      issues.push(issue("error", "project_without_proof_mission", at, "A selected project must state the distinct qualification it establishes."));
    }
    const key = normalizePurpose(project.proofMission);
    if (missions.has(key)) {
      issues.push(issue(
        "warning",
        "project_without_proof_mission",
        at,
        `"${project.displayName}" proves the same thing as "${missions.get(key)}". One of them is spending a line for nothing.`,
        "delete",
      ));
    } else {
      missions.set(key, project.displayName);
    }

    for (const claimId of project.claimIds) {
      if (verified.size && !verified.has(claimId)) {
        issues.push(issue("error", "unverified_claim", at, `"${project.displayName}" cites unverified claim "${claimId}".`));
      }
    }

    // Source visibility. A live product with private source is a legitimate and
    // often strong entry; implying its source is inspectable is not.
    const claimsOpenSource = project.statusClaims.includes("open_source");
    if (claimsOpenSource && project.sourceVisibility !== "public") {
      issues.push(issue(
        "error",
        "project_source_visibility_mismatch",
        at,
        `"${project.displayName}" is labelled open source while its source visibility is ` +
        `"${project.sourceVisibility}". A reader will go looking for code they cannot see.`,
        "rewrite",
      ));
    }
    if (project.artifactKind === "live_product_private_source" && claimsOpenSource) {
      issues.push(issue(
        "error",
        "project_source_visibility_mismatch",
        at,
        `"${project.displayName}" is a live product with private source and cannot also be open source.`,
        "rewrite",
      ));
    }

    // Status is a claim like any other. A reachable URL establishes
    // reachability; it does not establish release, installation or adoption.
    for (const status of project.statusClaims) {
      if (!OVERCLAIMED_STATUSES.includes(status)) continue;
      if (!project.claimIds.length) {
        issues.push(issue(
          "error",
          "project_status_overclaim",
          at,
          `"${project.displayName}" asserts "${status}" with no supporting claim. Prepared package metadata is ` +
          "not a release, and a reachable URL is not adoption.",
          "delete",
        ));
      }
    }

    if (project.canonicalUrl && !project.verifiedAt) {
      issues.push(issue(
        "warning",
        "project_dependency_stale",
        at,
        `"${project.displayName}" prints a URL that has never been confirmed against the live surface. ` +
        "A printed URL is part of the claim.",
        "make_specific",
      ));
    }

    // An umbrella or organisation name that the link does not open.
    if (project.canonicalUrl && !project.descriptor) {
      const slug = project.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const url = project.canonicalUrl.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (slug && !url.includes(slug)) {
        issues.push(issue(
          "warning",
          "project_identity_mismatch",
          at,
          `"${project.displayName}" does not appear in ${project.canonicalUrl}, and no descriptor explains what ` +
          "the link opens.",
          "rewrite",
        ));
      }
    }

    if (resume && renderedNames.size && !renderedNames.has(project.displayName)) {
      issues.push(issue("warning", "projects_plan_entry_unrendered", at, `"${project.displayName}" is selected but the resume does not render it.`));
    }
  }

  // #110 rule 11: the title describes the set that was actually selected.
  const kinds = new Set((plan?.selected || []).map((project) => project.artifactKind));
  const anyPublicSource = (plan?.selected || []).some((project) => project.sourceVisibility === "public");
  if (plan?.sectionTitle === "Open Source & Projects" && !anyPublicSource && kinds.size) {
    issues.push(issue(
      "warning",
      "project_section_title_mismatch",
      "projects",
      'The section is titled "Open Source & Projects" while no selected artifact has public source.',
      "rewrite",
    ));
  }

  for (const omitted of plan?.omitted || []) {
    if (!omitted.reason.trim()) {
      issues.push(issue("warning", "omission_without_reason", `projects:${omitted.displayName}`, "A dropped project needs a recorded reason."));
    }
  }

  return finish(issues);
}

/**
 * The dependency rule shared by #109 rule 10 and #110 rule 12.
 *
 * A skill is in the list because something proves it. When the proof is removed
 * -- a bullet cut for space, a project dropped for duplication -- the skill does
 * not become weaker, it becomes unproved *in this document*, and a reader who
 * looks for the evidence will not find it. Nothing else in the pipeline notices
 * this, because the skill still maps to a verified claim: the claim survived,
 * the visible proof did not.
 */
export function revalidateDependents({ skillsPlan, projectsPlan, resume, removedLocations = [] }) {
  const issues = [];
  const present = new Set(indexSegments(segmentResume(resume)).keys());
  const removed = new Set(removedLocations);

  for (const item of skillsPlan?.items || []) {
    if (item.decision !== "include") continue;
    if (!item.supportingLocations.length) continue;

    const surviving = item.supportingLocations.filter(
      (location) => present.has(location) && !removed.has(location)
    );
    if (surviving.length) continue;

    issues.push(issue(
      "warning",
      "skill_dependency_stale",
      `skills:${item.display}`,
      `Every resume location that proved "${item.display}" (${item.supportingLocations.join(", ")}) was removed. ` +
      "The claim ledger still supports it; this document no longer shows it. Re-select the skill or restore a proof.",
      "delete",
    ));
  }

  const renderedProjects = new Set((resume?.projects || []).map((project) => project.name).filter(Boolean));
  for (const item of skillsPlan?.items || []) {
    if (item.decision !== "include") continue;
    if (item.evidenceStatus !== "demonstrated_project") continue;
    const stillSelected = (projectsPlan?.selected || []).some(
      (project) => renderedProjects.has(project.displayName) &&
        project.claimIds.some((claimId) => item.claimIds.includes(claimId))
    );
    if (stillSelected) continue;
    issues.push(issue(
      "warning",
      "skill_dependency_stale",
      `skills:${item.display}`,
      `"${item.display}" is supported only by a project, and no selected project in this resume carries its claims.`,
      "delete",
    ));
  }

  for (const project of projectsPlan?.selected || []) {
    // No `renderedProjects.size` guard. An empty Projects section is precisely
    // the case worth catching: the plan still selects the project, every skill
    // that leaned on it still lists it, and nothing else in the pipeline looks.
    if (renderedProjects.has(project.displayName)) continue;
    issues.push(issue(
      "warning",
      "project_dependency_stale",
      `projects:${project.displayName}`,
      `"${project.displayName}" is selected in the projects plan but no longer rendered. Any skill or summary ` +
      "sentence that leaned on it needs re-checking.",
    ));
  }

  return finish(issues);
}

function finish(issues) {
  const errors = issues.filter((entry) => entry.severity === "error");
  return {
    schemaVersion: "1.0",
    valid: errors.length === 0,
    issues: errors,
    warnings: issues.filter((entry) => entry.severity !== "error"),
  };
}
