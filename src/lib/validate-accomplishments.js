import { RESTRICTION_RANK, renderAuthorization } from "./disclosure.js";
import { profileEditorialMarker } from "./profile-output-hygiene.js";

function issue(severity, code, message, location = "") {
  return { severity, code, message, location };
}

/**
 * Structural integrity of the accomplishment bank.
 *
 * The bank indexes claims; it never holds renderable prose. These checks keep that
 * invariant true: every unit points at claims that exist, every outcome points at a
 * claim the unit actually owns, and a unit can never present itself as less
 * confidential than the claims it is built from.
 */
export function validateAccomplishments({ bank, ledger, identity }) {
  const issues = [];
  const claimById = new Map((ledger?.claims || []).map((claim) => [claim.id, claim]));
  const experienceIds = new Set(
    [...(identity?.experience || []), ...(identity?.other_experience_compacted || [])]
      .filter((entry) => entry.id)
      .map((entry) => entry.id)
  );
  const seen = new Set();

  for (const unit of bank?.units || []) {
    const location = `unit:${unit.id}`;

    for (const field of ["title", "externalTitle"]) {
      if (!unit[field]) continue;
      const editorialMarker = profileEditorialMarker(unit[field]);
      if (editorialMarker) {
        issues.push(issue(
          "error",
          "unit_label_editorial_instruction",
          `Unit "${unit.id}" ${field} contains editorial guidance (${editorialMarker}) instead of a neutral retrieval label.`,
          `${location}.${field}`
        ));
      }
    }

    if (seen.has(unit.id)) {
      issues.push(issue("error", "duplicate_unit_id", `Unit id "${unit.id}" is declared more than once.`, location));
    }
    seen.add(unit.id);

    if (!experienceIds.has(unit.experienceId)) {
      issues.push(issue(
        "error",
        "unknown_experience_id",
        `Unit "${unit.id}" references experience "${unit.experienceId}" which does not exist in the identity record.`,
        location
      ));
    }

    if (unit.endDate && unit.startDate > unit.endDate) {
      issues.push(issue("error", "unit_date_range", `Unit "${unit.id}" ends before it starts.`, location));
    }
    if (unit.ongoing && unit.endDate) {
      issues.push(issue("error", "unit_date_range", `Ongoing unit "${unit.id}" must not declare an endDate.`, location));
    }

    let mostRestrictive = 0;
    for (const claimId of unit.claimIds || []) {
      const claim = claimById.get(claimId);
      if (!claim) {
        issues.push(issue("error", "unknown_claim", `Unit "${unit.id}" references unknown claim "${claimId}".`, location));
        continue;
      }
      if (claim.status !== "verified") {
        issues.push(issue(
          "error",
          "unverified_claim",
          `Unit "${unit.id}" references claim "${claimId}" with status ${claim.status}.`,
          location
        ));
      }
      const authorization = renderAuthorization(claim);
      if (authorization === "withheld_unclassified") {
        issues.push(issue(
          "warning",
          "unit_claim_disclosure_unclassified",
          `Unit "${unit.id}" references claim "${claimId}" with no disclosure classification.`,
          location
        ));
        continue;
      }
      mostRestrictive = Math.max(mostRestrictive, RESTRICTION_RANK[claim.disclosure] ?? 0);
    }

    if ((RESTRICTION_RANK[unit.disclosure] ?? 0) < mostRestrictive) {
      issues.push(issue(
        "error",
        "unit_disclosure_too_permissive",
        `Unit "${unit.id}" is declared ${unit.disclosure} but contains more restricted claims.`,
        location
      ));
    }

    const owned = new Set(unit.claimIds || []);
    for (const outcome of unit.outcomes || []) {
      if (!owned.has(outcome.claimId)) {
        issues.push(issue(
          "error",
          "outcome_claim_not_in_unit",
          `Unit "${unit.id}" outcome references claim "${outcome.claimId}" that the unit does not list.`,
          location
        ));
      }
    }

    for (const superseded of unit.supersedes || []) {
      if (!(bank?.units || []).some((other) => other.id === superseded)) {
        issues.push(issue(
          "error",
          "unknown_superseded_unit",
          `Unit "${unit.id}" supersedes unknown unit "${superseded}".`,
          location
        ));
      }
    }
  }

  return { valid: !issues.some((entry) => entry.severity === "error"), issues };
}

/**
 * Ranks units against a job's canonical terms. Every input is a scalar or enum,
 * so selection never requires parsing prose.
 */
export function rankAccomplishments({ bank, jobTerms = [], asOf = new Date() }) {
  const wanted = new Set(jobTerms.map((term) => String(term).toLowerCase()));
  const asOfMs = asOf instanceof Date ? asOf.getTime() : new Date(asOf).getTime();

  return (bank?.units || [])
    .map((unit) => {
      const stack = (unit.techStack || []).map((term) => term.toLowerCase());
      const overlap = stack.filter((term) => wanted.has(term));
      const endMs = unit.ongoing || !unit.endDate
        ? asOfMs
        : new Date(`${unit.endDate}-01T00:00:00Z`).getTime();
      const monthsAgo = Math.max(0, (asOfMs - endMs) / (1000 * 60 * 60 * 24 * 30.44));

      const score =
        overlap.length * 4 +
        { strong: 6, moderate: 3, weak: 1 }[unit.evidenceStrength?.tier ?? "weak"] +
        { sole_owner: 5, tech_lead: 5, major_contributor: 3, contributor: 1, reviewer: 1 }[unit.contribution] +
        { shipped_ga: 4, staged_rollout: 3, private_preview: 2, prototype: 1, internal_only: 1 }[
          unit.scope?.productionExposure ?? "internal_only"
        ] +
        (unit.outcomes || []).reduce((total, outcome) => total + (
          { production_measured: 4, development_measured: 3, projected: 1, unmeasured: 0 }[outcome.confidence] ?? 0
        ), 0) -
        Math.min(8, monthsAgo / 6);

      return { unitId: unit.id, score: Number(score.toFixed(2)), matchedTerms: overlap, monthsAgo: Math.round(monthsAgo) };
    })
    .sort((a, b) => b.score - a.score);
}
