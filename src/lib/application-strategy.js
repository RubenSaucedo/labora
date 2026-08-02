import { significantRequirementTokens } from "./job-requirements.js";
import { canonicalSkillsInText } from "./skill-aliases.js";
import { clearanceMatched } from "./eligibility.js";

function claimSupportsRequirement(claim, requirement) {
  const fact = String(claim?.fact || "");
  if (requirement.kind === "years" && requirement.minimumYears != null) {
    const years = [...fact.matchAll(/\b(\d+)\+?\s+years?\b/gi)].map((match) => Number(match[1]));
    if (!years.some((value) => value >= requirement.minimumYears)) return false;
  }
  if (requirement.kind === "authorization") {
    if (!/\b(?:authorized to work|work authorization|right to work|citizen|permanent resident)\b/i.test(fact)) {
      return false;
    }
    const jurisdictions = [
      ["united states", /\b(?:united states|u\.?s\.?a?)\b/i],
      ["canada", /\bcanada|canadian\b/i],
      ["united kingdom", /\b(?:united kingdom|u\.?k\.?|british)\b/i],
      ["european union", /\b(?:european union|e\.?u\.?)\b/i],
    ];
    const required = jurisdictions.find(([, pattern]) => pattern.test(requirement.text));
    return !required || required[1].test(fact);
  }
  if (requirement.kind === "clearance") {
    return clearanceMatched(requirement.text, fact);
  }
  if (requirement.kind === "license") {
    const acronyms = [
      ...requirement.text.matchAll(
        /\b([A-Z][A-Z0-9.-]{1,9})\s+(?:license|licensure|certification)\b/g
      ),
    ].map((match) => match[1]);
    const hasAcronyms = acronyms.length > 0 &&
      acronyms.every((token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(fact));
    if (acronyms.length) {
      return hasAcronyms &&
        /\b(?:licensed|license|certified|certification|credential|bar admission)\b/i.test(fact);
    }
    const phrases = [
      "bar admission",
      "medical license",
      "driver's license",
      "drivers license",
      "professional engineer license",
      "registered nurse license",
    ].filter((phrase) => requirement.text.toLowerCase().includes(phrase));
    return phrases.some((phrase) => fact.toLowerCase().includes(phrase));
  }
  if (requirement.canonicalTerms?.length) {
    const present = new Set(canonicalSkillsInText(fact).map((match) => match.canonicalId));
    return requirement.matchMode === "any"
      ? requirement.canonicalTerms.some((term) => present.has(term))
      : requirement.canonicalTerms.every((term) => present.has(term));
  }
  const tokens = significantRequirementTokens(requirement.text);
  if (!tokens.length) return false;
  const normalizedFact = fact.toLowerCase();
  return tokens.filter((token) => normalizedFact.includes(token)).length / tokens.length >= 0.6;
}

export function validateApplicationStrategy({ strategy, jobSpec, claimLedger, bank = null }) {
  const issues = [];
  const requirements = new Map((jobSpec?.requirements || []).map((item) => [item.id, item]));
  const verifiedClaims = new Map(
    (claimLedger?.claims || [])
      .filter((claim) => claim.status === "verified")
      .map((claim) => [claim.id, claim])
  );

  function checkRequirement(id, location) {
    if (!requirements.has(id)) {
      issues.push({
        code: "unknown_requirement",
        location,
        message: `Unknown requirement ID "${id}".`,
      });
    }
  }

  function checkClaim(id, location) {
    if (!verifiedClaims.has(id)) {
      issues.push({
        code: "unverified_claim",
        location,
        message: `Claim "${id}" is missing or not verified.`,
      });
    }
  }

  for (const [index, signal] of (strategy?.topSignals || []).entries()) {
    signal.requirementIds.forEach((id) =>
      checkRequirement(id, `topSignals[${index}].requirementIds`)
    );
    signal.claimIds.forEach((id) => checkClaim(id, `topSignals[${index}].claimIds`));
    for (const requirementId of signal.requirementIds) {
      const requirement = requirements.get(requirementId);
      if (!requirement) continue;
      const supported = signal.claimIds
        .map((claimId) => verifiedClaims.get(claimId))
        .filter(Boolean)
        .some((claim) => claimSupportsRequirement(claim, requirement));
      if (!supported) {
        issues.push({
          code: "claim_requirement_mismatch",
          location: `topSignals[${index}]`,
          message: `Mapped claims do not support requirement "${requirementId}".`,
        });
      }
    }
  }
  for (const [index, concern] of (strategy?.likelyConcerns || []).entries()) {
    checkRequirement(concern.requirementId, `likelyConcerns[${index}].requirementId`);
    const requirement = requirements.get(concern.requirementId);
    if (requirement && concern.severity !== requirement.severity) {
      issues.push({
        code: "severity_mismatch",
        location: `likelyConcerns[${index}].severity`,
        message: `Concern severity must match job-spec severity "${requirement.severity}".`,
      });
    }
    if (requirement && concern.text !== requirement.text) {
      issues.push({
        code: "requirement_text_mismatch",
        location: `likelyConcerns[${index}].text`,
        message: "Concern text must preserve the exact job requirement text.",
      });
    }
  }
  for (const [index, request] of (strategy?.evidenceRequests || []).entries()) {
    checkRequirement(request.requirementId, `evidenceRequests[${index}].requirementId`);
  }
  for (const id of strategy?.firstPagePlan?.leadClaimIds || []) {
    checkClaim(id, "firstPagePlan.leadClaimIds");
  }

  const shortlist = strategy?.unitShortlist || [];
  const units = new Map((bank?.units || []).map((unit) => [unit.id, unit]));
  if (shortlist.length) {
    const seenRanks = new Set();
    const seenUnits = new Set();
    for (const [index, entry] of shortlist.entries()) {
      const location = `unitShortlist[${index}]`;
      if (seenUnits.has(entry.unitId)) {
        issues.push({
          code: "duplicate_shortlist_unit",
          location,
          message: `Unit "${entry.unitId}" appears more than once in the shortlist.`,
        });
      }
      seenUnits.add(entry.unitId);
      if (seenRanks.has(entry.rank)) {
        issues.push({
          code: "duplicate_shortlist_rank",
          location,
          message: `Rank ${entry.rank} is used by more than one shortlist entry.`,
        });
      }
      seenRanks.add(entry.rank);
      entry.matchedRequirementIds.forEach((id) =>
        checkRequirement(id, `${location}.matchedRequirementIds`)
      );

      const unit = units.get(entry.unitId);
      if (!unit) {
        issues.push({
          code: "unknown_unit",
          location,
          message: bank
            ? `Unknown accomplishment unit "${entry.unitId}".`
            : `Cannot verify unit "${entry.unitId}" without an accomplishment bank.`,
        });
        continue;
      }
      // The shortlist is only useful if the units it names can actually carry
      // the requirements it claims they cover.
      for (const requirementId of entry.matchedRequirementIds) {
        const requirement = requirements.get(requirementId);
        if (!requirement) continue;
        const supported = unit.claimIds
          .map((claimId) => verifiedClaims.get(claimId))
          .filter(Boolean)
          .some((claim) => claimSupportsRequirement(claim, requirement));
        if (!supported) {
          issues.push({
            code: "unit_requirement_mismatch",
            location,
            message: `Unit "${entry.unitId}" has no verified claim supporting requirement "${requirementId}".`,
          });
        }
      }
    }
  }

  // Anti-anchoring gate.
  //
  // The failure mode this catches is silent omission: the job asks for
  // something, the candidate has verified proof of it, and the strategy simply
  // never looked. Requiring the agent to *consciously handle* every requirement
  // it has evidence for is what turns a large ledger into interviews instead of
  // leaving most of it unread.
  //
  // Handling a requirement means any of: shortlisting a unit that carries it,
  // leading with it in topSignals, or naming it as a concern. Only silence is
  // an issue.
  if (bank) {
    const handled = new Set([
      ...(strategy?.topSignals || []).flatMap((signal) => signal.requirementIds),
      ...(strategy?.likelyConcerns || []).map((concern) => concern.requirementId),
      ...shortlist.flatMap((entry) => entry.matchedRequirementIds),
    ]);
    const shortlistedClaims = new Set(
      shortlist.flatMap((entry) => units.get(entry.unitId)?.claimIds || [])
    );

    for (const requirement of requirements.values()) {
      if (handled.has(requirement.id)) continue;

      const proving = [...verifiedClaims.values()].filter((claim) =>
        claimSupportsRequirement(claim, requirement)
      );
      if (!proving.length) continue;
      if (proving.some((claim) => shortlistedClaims.has(claim.id))) continue;

      const carriers = (bank.units || [])
        .filter((unit) => proving.some((claim) => unit.claimIds.includes(claim.id)))
        .map((unit) => unit.id);

      issues.push({
        // Preferred and soft signals are advisory: a fuzzy term match should not
        // block a release over a nice-to-have.
        severity: ["hard_eligibility", "core"].includes(requirement.severity)
          ? "error"
          : "warning",
        code: "missed_evidence",
        location: "unitShortlist",
        message: `Requirement "${requirement.id}" is supported by verified claims (${proving
          .map((claim) => claim.id)
          .join(", ")}) that no shortlisted unit surfaces${
          carriers.length ? `; see ${carriers.join(", ")}` : ""
        }.`,
      });
    }
  }

  const pendingRequests = (strategy?.evidenceRequests || [])
    .filter((request) => request.resolution === "pending");
  const requestsByRequirement = new Map(
    (strategy?.evidenceRequests || []).map((request) => [request.requirementId, request])
  );
  const assessedRequirements = new Set([
    ...(strategy?.topSignals || []).flatMap((signal) => signal.requirementIds),
    ...(strategy?.likelyConcerns || []).map((concern) => concern.requirementId),
    ...shortlist.flatMap((entry) => entry.matchedRequirementIds),
  ]);
  for (const requirement of requirements.values()) {
    if (
      ["hard_eligibility", "core"].includes(requirement.severity) &&
      !assessedRequirements.has(requirement.id)
    ) {
      issues.push({
        code: "unassessed_requirement",
        location: "topSignals|likelyConcerns",
        message: `Hard/core requirement "${requirement.id}" was not assessed.`,
      });
    }
  }
  for (const concern of strategy?.likelyConcerns || []) {
    if (
      ["hard_eligibility", "core"].includes(concern.severity) &&
      ["unsupported", "uncertain"].includes(concern.evidenceStatus) &&
      !requestsByRequirement.has(concern.requirementId)
    ) {
      issues.push({
        code: "missing_evidence_request",
        location: "evidenceRequests",
        message: `Unsupported ${concern.severity} requirement "${concern.requirementId}" needs an evidence request.`,
      });
    }
  }
  const confirmedHardGap = (strategy?.likelyConcerns || []).some((concern) =>
    concern.severity === "hard_eligibility" &&
    ["unsupported", "uncertain"].includes(concern.evidenceStatus) &&
    requestsByRequirement.get(concern.requirementId)?.resolution === "candidate_has_no_evidence"
  );
  if (confirmedHardGap && strategy?.status !== "blocked") {
    issues.push({
      code: "unblocked_hard_eligibility",
      location: "status",
      message: "Confirmed missing hard eligibility requires blocked status.",
    });
  }
  const unresolvedHardGap = (strategy?.likelyConcerns || []).some((concern) =>
    concern.severity === "hard_eligibility" &&
    ["unsupported", "uncertain"].includes(concern.evidenceStatus)
  );
  if (unresolvedHardGap && strategy?.status === "ready") {
    issues.push({
      code: "unresolved_hard_eligibility",
      location: "status",
      message: "Unsupported or uncertain hard eligibility cannot have ready status.",
    });
  }
  if (strategy?.status === "ready" && pendingRequests.length) {
    issues.push({
      code: "pending_evidence",
      location: "status",
      message: "A ready strategy cannot contain pending evidence requests.",
    });
  }
  if (strategy?.status === "needs_evidence" && pendingRequests.length === 0) {
    issues.push({
      code: "missing_pending_request",
      location: "status",
      message: "A needs_evidence strategy must contain a pending evidence request.",
    });
  }

  // Existing issues carry no severity and are all blocking; only the advisory
  // missed_evidence warnings opt out.
  const errors = issues.filter((entry) => (entry.severity ?? "error") === "error");
  const warnings = issues.filter((entry) => entry.severity === "warning");

  return {
    schemaVersion: "1.0",
    valid: errors.length === 0,
    status: strategy?.status || "blocked",
    pendingEvidenceCount: pendingRequests.length,
    issues: errors,
    warnings,
  };
}
