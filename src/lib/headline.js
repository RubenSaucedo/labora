// headline.js — analysis of the resume headline (`ats_title`).
//
// The headline is the most-read line in the artifact and, until this module,
// the least validated: every other assertion is checked for claim support,
// while the headline was checked for containing a substring of another
// free-text resume field.
//
// Three deliberate constraints shape what is here.
//
// 1. Nothing in this module blocks a release. PHILOSOPHY.md is explicit that
//    lexical coverage may never block, and every signal available about a
//    headline is lexical. A false positive here would silently stop a truthful
//    application, which is the failure mode this pipeline drifts toward.
//
// 2. Requirement collisions are read from the structured job spec and the
//    claim ledger, never from ATS scoring. `resumeSearchableText` in
//    score-resume-ats.js includes `ats_title`, so a headline asserting a
//    capability makes that capability look covered — a check reading that
//    output would be reading its own input.
//
// 3. Phrases stay whole. Splitting "distributed systems" into two tokens
//    destroys the thing being assessed.
//
// Imports Node builtins and dependency-free labora sources only, so headline
// analysis runs on a machine where nothing is installed.
import { canonicalSkillsInText } from "./skill-aliases.js";
import { renderAuthorization } from "./disclosure.js";

const SEPARATOR = /\s*(?:[,|/·•]|—|–|(?:\s-\s))\s*/;

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The comma- or dash-delimited parts of a headline. Segments are the unit of
 * analysis because that is the unit a reader parses: "Senior Software Engineer,
 * Platform" makes two assertions, not four.
 */
export function headlineSegments(atsTitle) {
  return String(atsTitle ?? "")
    .split(SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Positioning is not a capability claim.
 *
 * A segment that restates the role being applied for says "this is the job I
 * am applying for", and is anchored by the posting itself. A segment naming a
 * capability or domain says "I can do this", and has to be grounded in the
 * ledger like any other assertion. Only the second kind is attested here.
 *
 * The anchor is the *role* alone — `target_role`, or the first segment of the
 * posting's title. Anchoring against the whole requisition title would exempt
 * exactly the segment that matters: a headline echoing "Software Engineer,
 * Workflows" would treat "Workflows" as positioning because the title contains
 * it, and the domain-term collision this module exists to surface would become
 * invisible the moment the headline copied the posting.
 */
export function classifySegments(atsTitle, { targetRole = "", jobTitle = "" } = {}) {
  const anchors = [normalize(targetRole), normalize(headlineSegments(jobTitle)[0] || "")]
    .filter(Boolean);
  const positioning = [];
  const qualifiers = [];

  for (const segment of headlineSegments(atsTitle)) {
    const key = normalize(segment);
    if (!key) continue;
    const isPositioning = anchors.some((anchor) => anchor.includes(key) || key.includes(anchor));
    (isPositioning ? positioning : qualifiers).push(segment);
  }
  return { positioning, qualifiers };
}

const claimIsUsable = (claim) => {
  if (!claim || claim.status !== "verified") return false;
  const authorization = renderAuthorization(claim);
  if (authorization === "authorized") return true;
  if (authorization === "requires_generalization") return Boolean(claim.externalFact);
  return false;
};

const renderableFact = (claim) => (claim?.externalFact ? claim.externalFact : claim?.fact || "");

/**
 * Requirements this headline segment speaks to, matched through the job spec's
 * own canonical terms and surface forms rather than raw word overlap.
 */
function requirementsMatching(segment, jobSpec) {
  const key = normalize(segment);
  if (!key) return [];
  return (jobSpec?.requirements || []).filter((requirement) => {
    const forms = [...(requirement.canonicalTerms || []), ...(requirement.surfaceForms || [])];
    return forms.some((form) => {
      const normalized = normalize(form);
      return normalized && (key.includes(normalized) || normalized.includes(key));
    });
  });
}

/** Verified, renderable claims whose fact speaks to a requirement's terms. */
function ledgerSupportFor(requirement, ledger) {
  const forms = [...(requirement.canonicalTerms || []), ...(requirement.surfaceForms || [])]
    .map(normalize)
    .filter(Boolean);
  if (!forms.length) return [];
  return (ledger?.claims || [])
    .filter(claimIsUsable)
    .filter((claim) => {
      const fact = normalize(renderableFact(claim));
      return forms.some((form) => fact.includes(form));
    });
}

function phraseAsWritten(requirement, form) {
  const text = String(requirement?.text || "");
  const index = text.toLowerCase().indexOf(String(form).toLowerCase());
  return index >= 0 ? text.slice(index, index + String(form).length) : String(form);
}

function groundedHeadlineAlternatives({
  segment,
  targetRole,
  jobSpec,
  ledger,
  excludedRequirementIds,
}) {
  const role = String(targetRole || headlineSegments(jobSpec?.title)[0] || "").trim();
  const alternatives = [];
  const seen = new Set();

  function add(alternative) {
    const key = normalize(alternative.headline);
    if (!key || seen.has(key) || key === normalize(`${role}, ${segment}`)) return;
    seen.add(key);
    alternatives.push(alternative);
  }

  if (role) {
    add({
      headline: role,
      qualifier: null,
      claimIds: [],
      basis: "role_positioning",
    });
  }

  for (const requirement of jobSpec?.requirements || []) {
    if (alternatives.length >= 3) break;
    if (excludedRequirementIds.has(requirement.id)) continue;
    if (!["core", "preferred", "soft_signal"].includes(requirement.severity)) continue;

    const supportingClaims = ledgerSupportFor(requirement, ledger);
    if (!supportingClaims.length) continue;
    const forms = [...(requirement.surfaceForms || []), ...(requirement.canonicalTerms || [])];
    const qualifier = forms.find((form) => {
      const key = normalize(form);
      return key && supportingClaims.some((claim) => normalize(renderableFact(claim)).includes(key));
    });
    if (!qualifier || normalize(qualifier) === normalize(segment)) continue;
    const writtenQualifier = phraseAsWritten(requirement, qualifier);
    add({
      headline: role ? `${role}, ${writtenQualifier}` : writtenQualifier,
      qualifier: writtenQualifier,
      claimIds: supportingClaims.map((claim) => claim.id),
      basis: "verified_claim",
    });
  }

  return alternatives;
}

function collisionIsNoted(resume, segment, requirementId) {
  const segmentKey = normalize(segment);
  const requirementKey = normalize(requirementId);
  const unresolvedPlaceholder = normalize(
    "Chosen action: <confirm the meaning or use a grounded alternative>"
  );
  return (resume?.notes_for_human || []).some((note) => {
    const key = normalize(note);
    return (
      key.includes(segmentKey) &&
      key.includes(requirementKey) &&
      !key.includes(unresolvedPlaceholder)
    );
  });
}

function jobSpecText(jobSpec) {
  if (!jobSpec) return "";
  return normalize(
    [jobSpec.title, ...(jobSpec.requirements || []).map((requirement) => requirement.text)].join(" ")
  );
}

/**
 * Diagnostics about the headline. Never errors, by design — see the module
 * note. Optional inputs degrade to fewer findings rather than to a failure,
 * because a resume validated before the job spec was wired in is not a defect.
 */
export function analyzeHeadline({
  atsTitle = "",
  targetRole = "",
  resume = {},
  ledger = null,
  jobSpec = null,
} = {}) {
  const findings = [];
  if (!String(atsTitle).trim()) return findings;

  const { qualifiers } = classifySegments(atsTitle, {
    targetRole,
    jobTitle: jobSpec?.title || "",
  });
  const declared = new Map(
    (resume?.provenance?.headline || []).map((entry) => [normalize(entry.term), entry])
  );
  const claimById = new Map((ledger?.claims || []).map((claim) => [claim.id, claim]));
  const postingText = jobSpecText(jobSpec);

  for (const segment of qualifiers) {
    const key = normalize(segment);
    const entry = declared.get(key);

    if (!entry) {
      findings.push({
        severity: "warning",
        code: "headline_term_unmapped",
        message:
          `The headline asserts "${segment}" with no claim provenance. ` +
          "Map it in provenance.headline, or drop it from the most-read line in the document.",
        location: "ats_title",
      });
    } else if (ledger) {
      const usable = entry.claimIds.map((id) => claimById.get(id)).filter(claimIsUsable);
      if (!usable.length) {
        findings.push({
          severity: "warning",
          code: "headline_term_unattested",
          message:
            `The headline asserts "${segment}", and none of its mapped claims is a verified, ` +
            "renderable claim. Unverified, rejected and internal-only claims cannot carry a headline.",
          location: "ats_title",
        });
      }
    }

    if (jobSpec && ledger) {
      const collisions = requirementsMatching(segment, jobSpec).filter((requirement) =>
        ["hard_eligibility", "core"].includes(requirement.severity) &&
        ledgerSupportFor(requirement, ledger).length === 0
      );
      const alternatives = groundedHeadlineAlternatives({
        segment,
        targetRole,
        jobSpec,
        ledger,
        excludedRequirementIds: new Set(collisions.map((requirement) => requirement.id)),
      });
      const alternativeText = alternatives.map((item) => `"${item.headline}"`).join(" or ");
      for (const requirement of collisions) {
        const suggestedNote =
          `Headline collision: "${segment}" overlaps ${requirement.id} ` +
          `("${requirement.text}"); the current claim ledger does not support that narrower ` +
          "posting meaning. Chosen action: <confirm the meaning or use a grounded alternative>.";
        findings.push({
          severity: "warning",
          code: "headline_requirement_collision",
          message:
            `The headline asserts "${segment}", which this posting uses for ${requirement.id} ` +
            `("${requirement.text}"). No verified claim speaks to that requirement, so the top ` +
            "line may adopt a narrower meaning than the body can defend. Confirm which sense is " +
            "meant, or lead with a qualifier the ledger carries." +
            (alternativeText ? ` Grounded options: ${alternativeText}.` : "") +
            " This review takes minutes and affects this application only.",
          location: "ats_title",
          alternatives,
          suggestedNote,
        });
        if (!collisionIsNoted(resume, segment, requirement.id)) {
          findings.push({
            severity: "warning",
            code: "headline_collision_note_missing",
            message:
              `The unresolved "${segment}" / ${requirement.id} collision is not recorded in ` +
              `notes_for_human. Add the supplied note and record the chosen action; this takes ` +
              "minutes and affects this application only.",
            location: "notes_for_human",
            suggestedNote,
          });
        }
      }
    }

    if (postingText && !postingText.includes(key)) {
      findings.push({
        severity: "info",
        code: "headline_term_absent_from_posting",
        message:
          `The posting never uses "${segment}". That is not a defect — it may be exactly the ` +
          "differentiator worth leading with — but prefer the posting's own phrasing when both are true.",
        location: "ats_title",
      });
    }
  }

  return findings;
}
