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

const claimIsUsable = (claim) =>
  Boolean(claim) && claim.status === "verified" && claim.disclosure !== "internal_only";

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
      for (const requirement of requirementsMatching(segment, jobSpec)) {
        if (!["hard_eligibility", "core"].includes(requirement.severity)) continue;
        if (ledgerSupportFor(requirement, ledger).length) continue;
        findings.push({
          severity: "warning",
          code: "headline_requirement_collision",
          message:
            `The headline asserts "${segment}", which this posting uses for ${requirement.id} ` +
            `("${requirement.text}"). No verified claim speaks to that requirement, so the top ` +
            "line may adopt a narrower meaning than the body can defend. Confirm which sense is " +
            "meant, or lead with a qualifier the ledger carries.",
          location: "ats_title",
        });
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
