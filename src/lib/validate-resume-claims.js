import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalSkillsInText } from "./skill-aliases.js";
import { skillVocabulary } from "./skill-vocabulary.js";
import { analyzeHeadline } from "./headline.js";
import { renderAuthorization } from "./disclosure.js";
import { validateObservations } from "./validate-observations.js";
import { loadManifest, resolveProvenance } from "./evidence-provenance.js";
import { analyzeProgression } from "./progression.js";
import {
  STALE_RECORD_REMEDY,
  UNSUPPORTED_ASSERTION,
  classifyRunState,
  rebuildPacket,
} from "./diagnostic-class.js";

const SUPPORT_STOPWORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "into", "of", "on",
  "the", "to", "using", "with", "that", "this", "their",
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[,\s]+/g, " ")
    .trim();
}

function numericTokens(value) {
  return [...new Set(
    String(value || "")
      .toLowerCase()
      .replace(/,/g, "")
      .match(/\b\d+(?:\.\d+)?(?:%|k|m|b|ms|x)?\+?\b/g) || []
  )].map((token) => token.replace(/\+$/, ""));
}

/**
 * A finding. `severity` says how much it matters; `class` says what kind of
 * wrong it is, which is what decides whether any other work may proceed.
 *
 * Errors default to `unsupported_assertion` because that is the assumption that
 * fails safe: a finding whose cause has not been positively established as
 * recoverable is treated as a factual defect. `remedy` upgrades a specific
 * finding only where the validator has evidence for the cause.
 */
function issue(severity, code, message, location = "", remedy = null) {
  const finding = { severity, code, message, location };
  if (severity !== "error") return finding;
  if (!remedy) return { ...finding, class: UNSUPPORTED_ASSERTION };
  return {
    ...finding,
    class: remedy.class,
    owner: remedy.owner,
    requiredAction: remedy.requiredAction,
    blocks: [...remedy.blocks],
    allows: [...remedy.allows],
  };
}

function stem(token) {
  return token
    .replace(/(?:ization|isation)$/, "ize")
    .replace(/(?:ations|ation)$/, "")
    .replace(/(?:ments|ment)$/, "")
    .replace(/(?:ated|ating)$/, "")
    .replace(/(?:ies)$/, "y")
    .replace(/(?:ed|ing|es|s)$/, "");
}

function substantiveTokens(value) {
  return [...new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9+#.]+/g, " ")
      .split(/\s+/)
      .filter((token) =>
        token.length >= 3 &&
        !SUPPORT_STOPWORDS.has(token) &&
        !/^\d/.test(token)
      )
      .map(stem)
      .filter((token) => token.length >= 2)
  )];
}

function textSupportRatio(candidate, evidence) {
  const candidateTokens = substantiveTokens(candidate);
  if (!candidateTokens.length) return 1;
  const evidenceTokens = new Set(substantiveTokens(evidence));
  const supported = candidateTokens.filter((token) => evidenceTokens.has(token));
  return supported.length / candidateTokens.length;
}

function unsupportedCanonicalTerms(candidate, evidence) {
  const candidateTerms = canonicalSkillsInText(candidate).map((match) => match.canonicalId);
  const evidenceTerms = new Set(canonicalSkillsInText(evidence).map((match) => match.canonicalId));
  return candidateTerms.filter((term) => !evidenceTerms.has(term));
}

function namedTerms(value) {
  const text = String(value || "");
  const terms = [];
  const matches = [...text.matchAll(/\b[A-Za-z][A-Za-z0-9.+#/-]*\b/g)];
  for (const match of matches) {
    const term = match[0];
    const sentenceStart = match.index === 0 || /[.!?]\s*$/.test(text.slice(0, match.index));
    const hasInternalCapital = /[a-z][A-Z]/.test(term);
    const hasTechPunctuation = /[.+#/]/.test(term);
    const isAcronym = /^[A-Z0-9]{2,}$/.test(term);
    const isCapitalizedMidSentence = !sentenceStart && /^[A-Z]/.test(term);
    if (hasInternalCapital || hasTechPunctuation || isAcronym || isCapitalizedMidSentence) {
      terms.push(term.toLowerCase());
    }
  }
  return [...new Set(terms)];
}

function unsupportedNamedTerms(candidate, evidence) {
  const normalizedEvidence = normalize(evidence);
  const evidenceCanonicalTerms = new Set(
    canonicalSkillsInText(evidence).map((match) => match.canonicalId)
  );
  return namedTerms(candidate).filter((term) => {
    if (normalizedEvidence.includes(normalize(term))) return false;
    const termCanonical = canonicalSkillsInText(term).map((match) => match.canonicalId);
    return !termCanonical.length || termCanonical.some((canonical) => !evidenceCanonicalTerms.has(canonical));
  });
}

function unsupportedNumericTokens(candidate, evidence) {
  const evidenceNumbers = new Set(numericTokens(evidence));
  return numericTokens(candidate).filter((token) => !evidenceNumbers.has(token));
}

function excerptSupports(text, excerpt) {
  return (
    unsupportedNumericTokens(text, excerpt).length === 0 &&
    unsupportedCanonicalTerms(text, excerpt).length === 0 &&
    unsupportedNamedTerms(text, excerpt).length === 0 &&
    textSupportRatio(text, excerpt) >= 0.4
  );
}

// The text a claim may contribute to rendered resume content. Generalized wording
// replaces the internal fact so confidentiality-safe phrasing is what gets validated.
function renderableFact(claim) {
  return claim.externalFact ? claim.externalFact : claim.fact;
}

function claimDisclosureIssue({ claimId, authorization, location, subject = "Claim" }) {
  if (authorization === "withheld_unclassified") {
    return issue(
      "error",
      "claim_disclosure_unclassified",
      `${subject} "${claimId}" has no disclosure classification and may not ground rendered resume content.`,
      location
    );
  }
  if (authorization === "withheld_confidential") {
    return issue(
      "error",
      "confidential_claim_rendered",
      `${subject} "${claimId}" is internal_only and may not ground rendered resume content.`,
      location
    );
  }
  return null;
}

function normalizedObject(value) {
  if (Array.isArray(value)) return value.map(normalizedObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizedObject(value[key])])
    );
  }
  return typeof value === "string" ? normalize(value) : value;
}

function normalizedMultiset(values) {
  return values.map((value) => JSON.stringify(normalizedObject(value))).sort();
}

/**
 * The key that decides whether a catalog entry was fabricated.
 *
 * It compares what a reader will see, so provenance is excluded: `claimIds`
 * records where a description came from, and is stripped from the artifact
 * before rendering. Including it would make a tailor that copies the visible
 * record faithfully but omits the metadata fail as though it had invented the
 * entry, and would make the check sensitive to the order of the IDs.
 */
function catalogKey(entry) {
  const { claimIds, ...rendered } = entry || {};
  return JSON.stringify(normalizedObject(rendered));
}

/**
 * The visible words of an identity-section entry, for asking whether the
 * human-authored corpus still says this. Provenance and identifiers are
 * excluded for the same reason `catalogKey` excludes `claimIds`: neither is
 * ever printed, and neither appears in a source document, so including them
 * would guarantee a support miss.
 */
function renderedEntryText(entry) {
  const { claimIds, id, ...rendered } = entry || {};
  const collect = (value) => {
    if (value == null) return [];
    if (Array.isArray(value)) return value.flatMap(collect);
    if (typeof value === "object") return Object.values(value).flatMap(collect);
    return [String(value)];
  };
  return collect(rendered).filter(Boolean).join(" ");
}

function withinDir(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function withinAnyRoot(candidate, roots) {
  return roots.some((root) => root && (candidate === root || withinDir(root, candidate)));
}

// A claim's provenance must travel with the persona. Persona data lives in a
// private workspace outside this repository, so a source recorded relative to
// the repo root is stranded the moment the persona moves. Resolve
// persona-relative first (the portable form), then fall back to repo-relative
// so ledgers written under the older layout keep validating.
//
// The two forms cannot collide: "profile/background.md" does not exist under a
// workspace root, and "personas/<n>/profile/background.md" does not exist under
// a persona root.
function resolveClaimSource(sourcePath, { personaRoot, workspaceRoot }) {
  const roots = [personaRoot, workspaceRoot].filter(Boolean);
  for (const root of roots) {
    const candidate = path.resolve(root, sourcePath);
    if (!withinAnyRoot(candidate, roots)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { path: candidate, contained: true };
    }
  }
  // Nothing existed. Report the more precise failure: escaping the permitted
  // roots is a different defect from simply being absent.
  const preferred = path.resolve(roots[0], sourcePath);
  return { path: preferred, contained: withinAnyRoot(preferred, roots) };
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function sourceMayGroundClaims(sourcePath, personaRoot) {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedPersona = path.resolve(personaRoot);
  const approvedProfileFiles = new Set([
    path.join(resolvedPersona, "profile", "career.md"),
    path.join(resolvedPersona, "profile", "background.md"),
  ]);
  if (approvedProfileFiles.has(resolvedSource)) return true;

  const evidenceRoot = path.join(
    resolvedPersona,
    "evidence",
    "performance-reviews"
  );
  const evidenceRelative = path.relative(evidenceRoot, resolvedSource);
  const evidenceSegments = evidenceRelative.split(path.sep);
  if (withinDir(evidenceRoot, resolvedSource) && evidenceSegments.includes("text")) {
    return true;
  }

  // Repository snapshots are machine-retrievable evidence: `snapshot-repos.js`
  // can re-fetch them and a reviewer can diff the result. Only the generated
  // markdown grounds claims, so a hand-edited file cannot enter the corpus
  // under a name the tool would never produce.
  const repositoriesRoot = path.join(resolvedPersona, "evidence", "repositories");
  if (
    withinDir(repositoriesRoot, resolvedSource) &&
    path.basename(resolvedSource) === "repositories.md"
  ) {
    return true;
  }

  // An observation record grounds claims from any evidence category, because
  // its authorization comes from its shape rather than its location: every
  // observation carries a measurement and an explicit boundary, and
  // `validate-observations` rejects impressions. Without this, the exploration
  // contract is unusable -- `evidence-exploration` instructs the researcher to
  // write the record and `profile-builder` to derive claims from it, while the
  // validator would refuse every one of them.
  const evidenceDir = path.join(resolvedPersona, "evidence");
  if (
    withinDir(evidenceDir, resolvedSource) &&
    path.basename(resolvedSource) === "observations.json"
  ) {
    return validateObservations(readJsonOrNull(resolvedSource) ?? {}).valid;
  }

  // Any other evidence file is authorized by being TYPED AND HASH-BOUND in
  // `evidence/PROVENANCE.json`, not by where it sits. This is what ends the
  // #9 trap, where the only way to make a document usable was to file it under
  // `performance-reviews/` -- which then made the renderer call it attested.
  //
  // Deliberately not a widening to `evidence/**`: an arbitrary file placed in
  // the tree still cannot ground a claim. It has to be declared, with a hash
  // that matches its bytes and a classification basis that could actually have
  // produced its declared kind.
  if (withinDir(evidenceDir, resolvedSource)) {
    const manifest = loadManifest(resolvedPersona);
    if (!manifest.present) return false;
    const resolved = resolveProvenance(resolvedSource, resolvedPersona, manifest);
    return resolved.state === "declared";
  }

  return false;
}

function periodSupported(period, evidence) {
  const tokens = String(period || "").toLowerCase().match(/\b(?:19|20)\d{2}\b|present|current/g) || [];
  const normalizedEvidence = normalize(evidence);
  return tokens.every((token) => normalizedEvidence.includes(token));
}

/**
 * How each rendered field of an identity record is grounded.
 *
 * The previous version of this check carried a hand-maintained list of field
 * *names* — `["name"]` for a certification, `["title"]` for an award — sitting
 * next to a schema that grew independently. Nothing connected the two, so
 * `issuer` and `year` reached a rendered resume never having been compared
 * against a source excerpt: a certification could be grounded by evidence
 * saying "AWS Solutions Architect" and still render "issued by Google, 2024".
 *
 * So fields are classified by *kind* instead, and every field of every schema
 * below appears in exactly one bucket:
 *
 *   `prose`      an assertion about the world, checked by containment
 *   `dates`      the same fact can be written "2019-2021" or "Jan 2019 -
 *                Mar 2021", so these are compared by date token
 *   `soft`       grounded the same way as prose, but a mismatch is a warning:
 *                a source that writes "Seattle" while identity writes
 *                "Seattle, WA" is a formatting difference, not a false claim
 *   `composed`   written *from* evidence rather than quoted from it, so it
 *                carries claim IDs instead (see the prose checks below)
 *   `notFactual` an identifier or a pointer, asserting nothing checkable
 *
 * A test asserts this map covers each schema exactly, so the next field added
 * to a schema fails loudly here instead of rendering unchecked.
 */
export const GROUNDED_RECORD_FIELDS = {
  experience: {
    prose: ["role", "company"],
    dates: ["period"],
    soft: ["location"],
    composed: ["progression"],
    notFactual: ["id"],
  },
  education: {
    prose: ["school", "degree"],
    dates: ["startDate", "endDate"],
    soft: ["location"],
    composed: [],
    notFactual: [],
  },
  projects: {
    prose: ["name"],
    dates: [],
    soft: [],
    composed: ["description", "highlights"],
    notFactual: ["link", "claimIds"],
  },
  certifications: {
    prose: ["name", "issuer"],
    dates: ["year"],
    soft: [],
    composed: [],
    notFactual: ["credential_id", "credential_url"],
  },
  awards_or_contributions: {
    prose: ["title"],
    dates: ["year"],
    soft: [],
    composed: ["description"],
    notFactual: ["link", "claimIds"],
  },
};

function fieldSupported(field, value, kind, claim, evidence) {
  if (kind === "dates") return periodSupported(value, `${claim.period || ""} ${evidence}`);
  return normalize(evidence).includes(normalize(value));
}

/**
 * Reports which rendered fields of a record no verified claim accounts for.
 *
 * Returns `{ grounded, unsupported, empty }`. A record is checked against each
 * verified claim as a whole rather than field by field across claims, because a
 * role grounded by one employer's evidence and a period grounded by another's
 * is not a grounded record.
 *
 * `empty` distinguishes a record with nothing checkable from a grounded one.
 * The previous implementation skipped absent fields — correct, since an absent
 * field renders nothing — but that made a record whose fields were *all* blank
 * vacuously supported by any verified claim.
 */
function recordGrounding(record, claims, spec) {
  const required = [...spec.prose, ...spec.dates];
  const soft = spec.soft || [];
  const present = [...required, ...soft].filter((field) => record[field]);
  if (present.length === 0) return { grounded: false, unsupported: [], empty: true };

  let bestUnsupported = null;
  for (const { claim, evidence } of claims) {
    if (claim.status !== "verified") continue;
    const hardMisses = required.filter(
      (field) => record[field] &&
        !fieldSupported(field, record[field], spec.dates.includes(field) ? "dates" : "prose", claim, evidence)
    );
    if (hardMisses.length > 0) {
      if (!bestUnsupported || hardMisses.length < bestUnsupported.length) bestUnsupported = hardMisses;
      continue;
    }
    const softMisses = soft.filter(
      (field) => record[field] && !fieldSupported(field, record[field], "soft", claim, evidence)
    );
    return { grounded: true, unsupported: [], empty: false, softMisses };
  }
  return { grounded: false, unsupported: bestUnsupported || required.filter((f) => record[f]), empty: false };
}

/**
 * Gates a set of claim IDs that ground rendered content.
 *
 * Every surface that renders composed prose — a progression step, a project
 * description, an award description — must clear the same three checks, so they
 * share one implementation rather than three that can drift apart.
 */
function claimProvenanceIssues(claimIds, claimById, location) {
  const found = [];
  for (const claimId of claimIds) {
    const claim = claimById.get(claimId);
    if (!claim) {
      found.push(issue("error", "unknown_claim", `Claim "${claimId}" does not exist.`, location));
      continue;
    }
    if (claim.status !== "verified") {
      found.push(issue("error", "unverified_claim", `Claim "${claimId}" is ${claim.status}.`, location));
    }
    const disclosureIssue = claimDisclosureIssue({
      claimId,
      authorization: renderAuthorization(claim),
      location,
    });
    if (disclosureIssue) {
      found.push(disclosureIssue);
    }
  }
  return found;
}

function identityProseContentIssues(text, mappedClaims, location) {
  const supportedText = mappedClaims.map(renderableFact).join(" ");
  const unsupportedContent = [
    ...unsupportedCanonicalTerms(text, supportedText),
    ...unsupportedNamedTerms(text, supportedText),
    ...unsupportedNumericTokens(text, supportedText),
  ];
  if (unsupportedContent.length) {
    return [issue(
      "error",
      "identity_prose_unsupported_content",
      `Mapped claims do not support: ${[...new Set(unsupportedContent)].join(", ")}.`,
      location
    )];
  }
  if (textSupportRatio(text, supportedText) < 0.3) {
    return [issue(
      "error",
      "identity_prose_claim_mismatch",
      "The identity prose is not substantively supported by its mapped claim text.",
      location
    )];
  }
  return [];
}

function splitSummarySentences(text) {
  const value = String(text || "").trim();
  if (!value) return [];
  if (typeof Intl?.Segmenter === "function") {
    return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(value)]
      .map((entry) => entry.segment.trim())
      .filter(Boolean);
  }
  return value.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((entry) => entry.trim()).filter(Boolean) || [];
}

function normalizeSummaryFragment(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summaryWordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

const SUMMARY_ACTION_VERBS =
  /\b(?:owned|led|built|implemented|designed|created|shipped|launched|delivered|developed|established|introduced|migrated|reduced|improved|automated|reviewed|advised|co-designed|helped define)\b/i;
const SUMMARY_MAINTENANCE_TERMS =
  /\b(?:maintains?|maintained|operates?|operated|sustains?|sustained|ongoing maintenance|continues? to|oversees?|keeps? running|provides? ongoing support)\b/i;
const SUMMARY_DURABLE_RUNTIME_TERMS =
  /\b(?:durable execution|durable runtime|persistent runtime|long-running runtime|production runtime|runtime durability)\b/i;
const SUMMARY_LIFECYCLE_MERGE =
  /\b(?:end-to-end|full lifecycle|from .{1,60} (?:through|to) .{1,60}|design (?:through|to) (?:launch|delivery|deployment|operation)|through (?:launch|delivery|deployment|operation))\b/i;

function summaryClauseContentIssues(text, mappedClaims, location) {
  const supportedText = mappedClaims.map(renderableFact).join(" ");
  const unsupportedContent = [
    ...unsupportedCanonicalTerms(text, supportedText),
    ...unsupportedNamedTerms(text, supportedText),
    ...unsupportedNumericTokens(text, supportedText),
  ];
  const found = [];
  if (unsupportedContent.length || textSupportRatio(text, supportedText) < 0.3) {
    found.push(issue(
      "error",
      "summary_claim_mismatch",
      "The summary clause contains content not directly supported by its mapped claims.",
      location
    ));
  }

  const guardedLanguage = [
    ["summary_unsupported_leadership", /\bowned\b/i, /\bowned\b/i, "ownership verb"],
    ["summary_unsupported_leadership", /\bled\b/i, /\b(?:led|lead)\b/i, "leadership verb"],
    ["summary_unsupported_leadership", /\bdrove\b/i, /\b(?:drove|driven)\b/i, "leadership verb"],
    ["summary_unsupported_leadership", /\bdirected\b/i, /\bdirected\b/i, "leadership verb"],
    ["summary_unsupported_leadership", /\bspearheaded\b/i, /\bspearheaded\b/i, "leadership verb"],
    ["summary_unsupported_leadership", /\barchitected\b/i, /\barchitected\b/i, "architecture-ownership verb"],
    ["summary_unsupported_leadership", /\bestablished\b/i, /\bestablished\b/i, "leadership verb"],
    ["summary_unsupported_completion", /\blaunch(?:ed|ing)?\b/i, /\blaunch(?:ed|ing)?\b/i, "launch term"],
    ["summary_unsupported_completion", /\b(?:rollout|rolled out)\b/i, /\b(?:rollout|rolled out)\b/i, "rollout term"],
    ["summary_unsupported_completion", /\bshipped\b/i, /\bshipped\b/i, "shipping term"],
    ["summary_unsupported_completion", /\bdelivered\b/i, /\bdelivered\b/i, "delivery-completion term"],
    ["summary_unsupported_completion", /\breleased\b/i, /\breleased\b/i, "release-completion term"],
    ["summary_unsupported_completion", /\bdeployed\b/i, /\bdeployed\b/i, "deployment-completion term"],
    ["summary_unsupported_completion", /\bcompleted\b/i, /\bcompleted\b/i, "completion term"],
    ["summary_unsupported_maintenance", SUMMARY_MAINTENANCE_TERMS, SUMMARY_MAINTENANCE_TERMS, "ongoing-maintenance claim"],
    ["summary_unsupported_durable_runtime", SUMMARY_DURABLE_RUNTIME_TERMS, SUMMARY_DURABLE_RUNTIME_TERMS, "durable-runtime claim"],
  ];
  for (const [code, candidatePattern, evidencePattern, label] of guardedLanguage) {
    candidatePattern.lastIndex = 0;
    const present = candidatePattern.test(text);
    evidencePattern.lastIndex = 0;
    const supported = evidencePattern.test(supportedText);
    if (present && !supported) {
      found.push(issue(
        "error",
        code,
        `The summary uses a ${label} that its mapped claims do not support.`,
        location
      ));
    }
  }

  const pluralArtifacts = [
    "agents",
    "artifacts",
    "capabilities",
    "platforms",
    "products",
    "services",
    "systems",
    "tools",
    "workflows",
  ];
  const normalizedEvidence = normalize(supportedText);
  for (const artifact of pluralArtifacts) {
    if (
      new RegExp(`\\b${artifact}\\b`, "i").test(text) &&
      !new RegExp(`\\b${artifact}\\b`, "i").test(normalizedEvidence)
    ) {
      found.push(issue(
        "error",
        "summary_unsupported_plural_artifact",
        `The plural artifact "${artifact}" is not supported by the mapped claims.`,
        location
      ));
    }
  }

  const generalizedClaims = mappedClaims.filter(
    (claim) => claim.disclosure === "internal_generalizable"
  );
  const jargon = namedTerms(text).filter((term) =>
    canonicalSkillsInText(term).length === 0 &&
    generalizedClaims.some((claim) => normalize(renderableFact(claim)).includes(normalize(term)))
  );
  if (jargon.length) {
    found.push(issue(
      "warning",
      "summary_internal_jargon",
      `Review internal jargon in the summary: ${[...new Set(jargon)].join(", ")}.`,
      location
    ));
  }
  return found;
}

function summaryPlanCoverageIssues({ plan, sentenceMappings }) {
  if (!plan) return [];
  const found = [];

  const idsFor = (mapping, field) =>
    new Set((mapping?.clauses || []).flatMap((clause) => clause[field] || []));
  const check = ({ sentenceIndex, claimIds, unitIds, code, label }) => {
    const mapping = sentenceMappings[sentenceIndex];
    const sentenceClaims = idsFor(mapping, "claimIds");
    const sentenceUnits = idsFor(mapping, "unitIds");
    const missingClaims = (claimIds || []).filter((id) => !sentenceClaims.has(id));
    const missingUnits = (unitIds || []).filter((id) => !sentenceUnits.has(id));
    if (missingClaims.length || missingUnits.length) {
      found.push(issue(
        "error",
        code,
        `${label} sentence is missing planned provenance${
          missingClaims.length ? ` claims: ${missingClaims.join(", ")}` : ""
        }${missingUnits.length ? ` units: ${missingUnits.join(", ")}` : ""}.`,
        `summary.sentences[${sentenceIndex}]`
      ));
    }
  };

  check({
    sentenceIndex: 0,
    claimIds: plan.identity?.claimIds,
    unitIds: plan.identity?.unitIds,
    code: "summary_identity_plan_mismatch",
    label: "Identity",
  });
  check({
    sentenceIndex: 1,
    claimIds: plan.recentProof?.claimIds,
    unitIds: [plan.recentProof?.primaryUnitId].filter(Boolean),
    code: "summary_recent_proof_plan_mismatch",
    label: "Recent proof",
  });
  if (plan.differentiator) {
    check({
      sentenceIndex: 2,
      claimIds: plan.differentiator.claimIds,
      unitIds: plan.differentiator.unitIds,
      code: "summary_differentiator_plan_mismatch",
      label: "Differentiator",
    });
  }
  return found;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function validateResumeClaims({
  resume,
  identity,
  ledger,
  bank = null,
  // Optional. Absent, the headline collision and posting-vocabulary checks
  // stay silent rather than guessing: a resume validated before the job spec
  // was wired in is out of date, not invalid.
  jobSpec = null,
  applicationStrategy = null,
  workspaceRoot = process.cwd(),
  personaRoot,
}) {
  const vocabulary = skillVocabulary({ identity, bank });
  const issues = [];
  const claimById = new Map(ledger.claims.map((claim) => [claim.id, claim]));
  const identityExperienceById = new Map(
    [...(identity.experience || []), ...(identity.other_experience_compacted || [])]
      .filter((entry) => entry.id)
      .map((entry) => [entry.id, entry])
  );

  const resolvedRoot = fs.realpathSync(path.resolve(workspaceRoot));
  const resolvedPersonaRoot = fs.realpathSync(path.resolve(personaRoot || workspaceRoot));

  // Staleness is established by evidence, never by a timestamp. Every claim
  // source records the sha256 of the file it was verified against, so a source
  // whose bytes no longer hash to that value proves the generated records were
  // built from a different version of the human-authored corpus. A checkout, a
  // copy, or a clock skew cannot fake this signal, and nothing else in the
  // pipeline can produce it.
  const changedSources = new Set();
  const sourceChanged = (sourcePath, recordedHash) => {
    if (sha256(sourcePath) === recordedHash) return false;
    changedSources.add(path.relative(resolvedPersonaRoot, sourcePath).split(path.sep).join("/"));
    return true;
  };

  // Why an identity-section check failed decides what may happen next, so it is
  // established from evidence rather than assumed.
  //
  // Two facts must both hold before a mismatch is called recoverable: the
  // generated records were provably built from different source bytes
  // (`changedSources`), and the disputed entry is substantively present in the
  // corpus as it stands today. The first alone would excuse a fabrication that
  // happened to coincide with an unrelated edit. The second alone would excuse
  // a hand-edited generated record. Together they describe exactly one
  // situation: the human-authored source moved ahead of `profile/generated/`.
  //
  // Anything else stays an unsupported assertion, which is the failure the
  // anti-fabrication guarantee exists to catch.
  const currentApprovedCorpus = (() => {
    let corpus = null;
    return () => {
      if (corpus !== null) return corpus;
      const seen = new Set();
      const parts = [];
      for (const claim of ledger.claims) {
        for (const source of claim.sources || []) {
          const resolution = resolveClaimSource(source.path, {
            personaRoot: resolvedPersonaRoot,
            workspaceRoot: resolvedRoot,
          });
          if (!resolution.contained) continue;
          if (!fs.existsSync(resolution.path) || !fs.statSync(resolution.path).isFile()) continue;
          const real = fs.realpathSync(resolution.path);
          if (seen.has(real)) continue;
          if (!sourceMayGroundClaims(real, resolvedPersonaRoot)) continue;
          seen.add(real);
          parts.push(fs.readFileSync(real, "utf8"));
        }
      }
      corpus = parts.join("\n");
      return corpus;
    };
  })();

  const identitySectionRemedy = (entries) => {
    if (!changedSources.size) return null;
    if (!entries.length) return null;
    const corpus = currentApprovedCorpus();
    if (!corpus) return null;
    const supported = entries.every((entry) => excerptSupports(renderedEntryText(entry), corpus));
    return supported ? STALE_RECORD_REMEDY : null;
  };

  const staleSuffix = () =>
    ` The approved source changed (${[...changedSources].sort().join(", ")}), ` +
    `so profile/generated/ is behind it. Rebuild with profile-builder; content review may continue meanwhile.`;

  const claimEvidence = new Map();
  const readExcerpts = (sources, sourceLocation) => {
    const excerpts = [];
    let staleSources = false;
    for (const source of sources || []) {
      const permittedRoots = [resolvedPersonaRoot, resolvedRoot];
      const resolution = resolveClaimSource(source.path, {
        personaRoot: resolvedPersonaRoot,
        workspaceRoot: resolvedRoot,
      });
      if (!resolution.contained) {
        issues.push(issue("error", "source_outside_root", `Source "${source.path}" resolves outside the persona workspace.`, sourceLocation));
        continue;
      }
      const candidateSourcePath = resolution.path;
      if (!fs.existsSync(candidateSourcePath) || !fs.statSync(candidateSourcePath).isFile()) {
        issues.push(issue("error", "source_missing", `Source "${source.path}" does not exist.`, sourceLocation));
        continue;
      }
      const sourcePath = fs.realpathSync(candidateSourcePath);
      if (!withinAnyRoot(sourcePath, permittedRoots)) {
        issues.push(issue("error", "source_outside_root", `Source "${source.path}" resolves outside the persona workspace.`, sourceLocation));
        continue;
      }
      if (!sourceMayGroundClaims(sourcePath, resolvedPersonaRoot)) {
        issues.push(issue(
          "error",
          "source_not_approved",
          `Source "${source.path}" is outside the active persona's approved grounding corpus.`,
          sourceLocation
        ));
        continue;
      }
      if (sourceChanged(sourcePath, source.fileHash)) {
        staleSources = true;
        issues.push(issue(
          "error",
          "source_hash_mismatch",
          `Source "${source.path}" changed after claim verification. The generated ` +
          `records were built from an earlier version of this file; rebuild them with profile-builder.`,
          sourceLocation,
          STALE_RECORD_REMEDY
        ));
        continue;
      }
      if (source.lineStart == null || source.lineEnd == null) {
        issues.push(issue("error", "source_excerpt_missing", `Source "${source.path}" requires an exact line range.`, sourceLocation));
        continue;
      }
      const lines = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/);
      const start = source.lineStart;
      const end = source.lineEnd;
      if (start > end || end > lines.length) {
        issues.push(issue("error", "source_line_range", `Source line range is invalid for "${source.path}".`, sourceLocation));
        continue;
      }
      excerpts.push(lines.slice(start - 1, end).join("\n"));
    }
    return { excerpts, staleSources };
  };

  for (const claim of ledger.claims) {
    const sourceLocation = `claim:${claim.id}`;
    const { excerpts, staleSources } = readExcerpts(claim.sources, sourceLocation);
    claimEvidence.set(claim.id, excerpts.join("\n"));
    if (!excerpts.some((excerpt) => excerptSupports(claim.fact, excerpt))) {
      // A claim whose only source moved on has no excerpt to be judged against.
      // That is a consequence of the staleness, not independent evidence of
      // fabrication, so it carries the staleness remedy rather than dragging an
      // otherwise recoverable run back to a hard stop.
      const staleEvidence = staleSources && !excerpts.length;
      issues.push(issue(
        "error",
        "claim_source_mismatch",
        `Claim "${claim.id}" is not substantively supported by its referenced source excerpt.` +
        (staleEvidence
          ? " Its only source changed after verification, so no excerpt could be read; rebuild before judging this claim."
          : ""),
        sourceLocation,
        staleEvidence ? STALE_RECORD_REMEDY : null
      ));
    }

    if (claim.disclosure === "internal_generalizable" && !claim.externalFact) {
      issues.push(issue(
        "error",
        "external_fact_missing",
        `Claim "${claim.id}" is internal_generalizable and requires an externalFact for rendering.`,
        sourceLocation
      ));
    }

    if (claim.externalFact) {
      // A generalization may drop detail but must never introduce a number, and every
      // named or canonical term it uses must trace back to the internal fact or to an
      // approved source that authorizes the generalized wording.
      const generalizationEvidence = [
        claim.fact,
        ...readExcerpts(claim.externalSources, sourceLocation).excerpts,
      ].join("\n");
      const invented = [
        ...unsupportedNumericTokens(claim.externalFact, claim.fact),
        ...unsupportedCanonicalTerms(claim.externalFact, generalizationEvidence),
        ...unsupportedNamedTerms(claim.externalFact, generalizationEvidence),
      ];
      if (invented.length) {
        issues.push(issue(
          "error",
          "external_fact_ungrounded",
          `Claim "${claim.id}" externalFact introduces unsupported content: ${invented.join(", ")}.`,
          sourceLocation
        ));
      }
    }
  }

  const verifiedClaimEvidence = ledger.claims.map((claim) => ({
    claim,
    evidence: `${claim.fact}\n${claimEvidence.get(claim.id) || ""}`,
  }));
  for (const entry of [...(identity.experience || []), ...(identity.other_experience_compacted || [])]) {
    const label = entry.id || entry.role;
    const result = recordGrounding(entry, verifiedClaimEvidence, GROUNDED_RECORD_FIELDS.experience);
    if (!result.grounded) {
      // The excerpt that used to ground this record can become unreadable when
      // its source moves on, and the record then looks unproven for a reason
      // that has nothing to do with what it says. Ask the corpus as it stands
      // today: if it still states the record, this is rebuild debt, not a
      // fabricated employer.
      const remedy = result.empty ? null : identitySectionRemedy([entry]);
      issues.push(issue(
        "error",
        "identity_experience_unproven",
        (result.empty
          ? `Identity experience "${label}" carries no role, company or period to ground. Fill it in from an approved source, or remove the entry.`
          : `Identity experience "${label}" is not grounded in an approved source excerpt: ${result.unsupported.join(", ")}. Add a source excerpt covering ${result.unsupported.length === 1 ? "that field" : "those fields"}, or correct the entry to match the evidence.`) +
        (remedy ? staleSuffix() : ""),
        `identity.experience:${label}`,
        remedy
      ));
    }
    for (const field of result.softMisses || []) {
      issues.push(issue(
        "warning",
        "identity_field_unconfirmed",
        `Identity experience "${label}" renders ${field} "${entry[field]}", which the grounding source excerpt does not state. Confirm it before sending.`,
        `identity.experience:${label}.${field}`
      ));
    }
  }
  for (const [field, spec] of Object.entries(GROUNDED_RECORD_FIELDS)) {
    if (field === "experience") continue;
    for (const [index, record] of (identity[field] || []).entries()) {
      const result = recordGrounding(record, verifiedClaimEvidence, spec);
      if (!result.grounded) {
        issues.push(issue(
          "error",
          "identity_record_unproven",
          result.empty
            ? `identity ${field}[${index}] carries no checkable content. Fill it in from an approved source, or remove the entry.`
            : `identity ${field}[${index}] is not grounded in an approved source excerpt: ${result.unsupported.join(", ")}. Add a source excerpt covering ${result.unsupported.length === 1 ? "that field" : "those fields"}, or correct the entry to match the evidence.`,
          `identity.${field}[${index}]`
        ));
      }
      for (const soft of result.softMisses || []) {
        issues.push(issue(
          "warning",
          "identity_field_unconfirmed",
          `identity ${field}[${index}] renders ${soft} "${record[soft]}", which the grounding source excerpt does not state. Confirm it before sending.`,
          `identity.${field}[${index}].${soft}`
        ));
      }
    }
  }

  // Atomic fields above are grounded by matching them against a source excerpt.
  // Composed prose cannot be: a description is written *from* evidence, not
  // quoted from it, so substring containment would reject every honestly
  // written record. Prose therefore names the claims it was composed from, the
  // same contract a rendered bullet meets.
  //
  // Only records that actually carry prose are gated. A project with no
  // description and no highlights renders nothing that needs grounding beyond
  // its already-checked name.
  const proseChecks = [
    ["projects", ["description", "highlights"]],
    ["awards_or_contributions", ["description"]],
  ];
  for (const [field, proseFields] of proseChecks) {
    for (const [index, record] of (identity[field] || []).entries()) {
      const location = `identity.${field}[${index}]`;
      const carriesProse = proseFields.some((proseField) => {
        const value = record[proseField];
        return Array.isArray(value)
          ? value.some((item) => String(item || "").trim())
          : String(value || "").trim();
      });
      if (!carriesProse) continue;

      const claimIds = record.claimIds || [];
      if (claimIds.length === 0) {
        issues.push(issue(
          "error",
          "identity_prose_unmapped",
          `identity ${field}[${index}] renders composed prose and requires claim provenance in "claimIds".`,
          location
        ));
        continue;
      }
      const provenanceIssues = claimProvenanceIssues(claimIds, claimById, location);
      issues.push(...provenanceIssues);
      if (provenanceIssues.length) continue;

      const mappedClaims = claimIds.map((claimId) => claimById.get(claimId));
      for (const proseField of proseFields) {
        const value = record[proseField];
        const fragments = Array.isArray(value) ? value : [value];
        for (const [fragmentIndex, fragment] of fragments.entries()) {
          const text = String(fragment || "").trim();
          if (!text) continue;
          const fragmentLocation = Array.isArray(value)
            ? `${location}.${proseField}[${fragmentIndex}]`
            : `${location}.${proseField}`;
          issues.push(...identityProseContentIssues(text, mappedClaims, fragmentLocation));
        }
      }
    }
  }

  const bulletMappings = new Map();
  for (const mapping of resume.provenance?.bullets || []) {
    const key = `${mapping.experienceId}:${mapping.bulletIndex}`;
    if (bulletMappings.has(key)) {
      issues.push(issue("error", "duplicate_bullet_mapping", `Duplicate provenance mapping for ${key}.`, key));
    }
    bulletMappings.set(key, mapping);
  }

  const usedClaimSets = new Map();
  for (const [experienceIndex, entry] of (resume.experience || []).entries()) {
    const coreEntry = identityExperienceById.get(entry.id);
    const location = `experience[${experienceIndex}]`;

    if (!entry.id) {
      issues.push(issue("error", "missing_experience_id", "Every tailored experience entry requires a stable id.", location));
    } else if (!coreEntry) {
      issues.push(issue("error", "unknown_experience_id", `Experience id "${entry.id}" does not exist in the identity record.`, location));
    }

    if (coreEntry) {
      for (const field of ["company", "role", "period"]) {
        if (normalize(entry[field]) !== normalize(coreEntry[field])) {
          issues.push(issue(
            "error",
            "experience_identity_changed",
            `${field} must match the identity record for experience "${entry.id}".`,
            `${location}.${field}`
          ));
        }
      }
    }

    // A promotion is rendered content, so it is gated exactly like a bullet: it
    // must exist in the identity spine, be backed by verified, disclosable
    // claims, and never leak an internal ladder token.
    for (const [stepIndex, step] of (entry.progression || []).entries()) {
      const stepLocation = `${location}.progression[${stepIndex}]`;
      const authorization = renderAuthorization(step);
      if (authorization === "withheld_confidential") continue;
      if (authorization === "withheld_unclassified") {
        issues.push(issue(
          "warning",
          "progression_disclosure_unclassified",
          `Progression step "${step.label}" has no disclosure classification and is withheld from rendering.`,
          stepLocation
        ));
        continue;
      }
      if (
        authorization === "requires_generalization" &&
        !String(step.externalLabel || "").trim()
      ) {
        issues.push(issue(
          "error",
          "progression_label_not_generalized",
          `Progression step "${step.label}" is internal_generalizable and requires an externalLabel to render.`,
          stepLocation
        ));
        continue;
      }

      const coreStep = (coreEntry?.progression || []).find(
        (candidate) => normalize(candidate.label) === normalize(step.label)
      );
      if (!coreStep) {
        issues.push(issue(
          "error",
          "progression_not_in_identity",
          `Progression step "${step.label}" is not present in the identity record for "${entry.id}".`,
          stepLocation
        ));
        continue;
      }

      if (step.claimIds.length === 0) {
        issues.push(issue(
          "error",
          "unmapped_progression",
          `Progression step "${step.label}" requires claim provenance.`,
          stepLocation
        ));
      }
      issues.push(...claimProvenanceIssues(step.claimIds, claimById, stepLocation));

      // The step is matched to the identity record by `label`, but `label` is
      // not what prints: `formatProgression` renders `externalLabel` in its
      // place whenever one is set, applies `externalLabelKind`, and includes
      // `date`. Checking only `label` leaves wording, visibility semantics, and
      // year free to drift while the step still resolves to a real,
      // claim-backed promotion.
      for (const field of ["externalLabel", "externalLabelKind", "date"]) {
        if (normalize(step[field] || "") !== normalize(coreStep[field] || "")) {
          issues.push(issue(
            "error",
            "progression_identity_changed",
            `${field} must match the identity record for progression step "${step.label}".`,
            `${stepLocation}.${field}`
          ));
        }
      }

    }

    const progressionAnalysis = analyzeProgression(entry.progression, entry.role);
    for (const finding of progressionAnalysis.findings) {
      const findingLocation = finding.stepIndex == null
        ? `${location}.progression`
        : `${location}.progression[${finding.stepIndex}]`;
      if (finding.code === "progression_generic_placeholder") {
        issues.push(issue(
          "warning",
          finding.code,
          `Generic progression label "${finding.label}" is suppressed. If verified career jumps are important, classify the step as "scope_change"; otherwise leave it suppressed.`,
          findingLocation
        ));
      } else if (finding.code === "progression_duplicates_heading") {
        issues.push(issue(
          "warning",
          finding.code,
          `Progression label "${finding.label}" duplicates the experience heading and is suppressed. Use a distinct verified title or scope-change label if one exists.`,
          findingLocation
        ));
      } else if (finding.code === "progression_low_information") {
        issues.push(issue(
          "warning",
          finding.code,
          "Fewer than two information-bearing progression events remain, so the line is omitted. Add verified external wording only when it changes what a reader can understand.",
          findingLocation
        ));
      }
    }

    for (const [bulletIndex, bullet] of (entry.bullets || []).entries()) {
      const key = `${entry.id}:${bulletIndex}`;
      const mapping = bulletMappings.get(key);
      const bulletLocation = `${location}.bullets[${bulletIndex}]`;
      if (!mapping) {
        issues.push(issue("error", "unmapped_bullet", "Every resume bullet requires claim provenance.", bulletLocation));
        continue;
      }

      const mappedClaims = [];
      for (const claimId of mapping.claimIds) {
        const claim = claimById.get(claimId);
        if (!claim) {
          issues.push(issue("error", "unknown_claim", `Claim "${claimId}" does not exist.`, bulletLocation));
          continue;
        }
        if (claim.status !== "verified") {
          issues.push(issue("error", "unverified_claim", `Claim "${claimId}" is ${claim.status}.`, bulletLocation));
        }
        const disclosureIssue = claimDisclosureIssue({
          claimId,
          authorization: renderAuthorization(claim),
          location: bulletLocation,
        });
        if (disclosureIssue) {
          issues.push(disclosureIssue);
        }
        mappedClaims.push(claim);
      }

      const claimSet = [...new Set(mapping.claimIds)].sort().join("|");
      if (claimSet) {
        const previous = usedClaimSets.get(claimSet);
        if (previous) {
          issues.push(issue(
            "error",
            "duplicate_claim_usage",
            `The same claim set is already used by ${previous}.`,
            bulletLocation
          ));
        } else {
          usedClaimSets.set(claimSet, bulletLocation);
        }
      }

      const supportedText = mappedClaims.map(renderableFact).join(" ");
      const unsupportedTerms = unsupportedCanonicalTerms(bullet, supportedText);
      const unsupportedNames = unsupportedNamedTerms(bullet, supportedText);
      if (unsupportedTerms.length || unsupportedNames.length) {
        issues.push(issue(
          "error",
          "unsupported_technology",
          `Mapped claims do not support: ${[...unsupportedTerms, ...unsupportedNames].join(", ")}.`,
          bulletLocation
        ));
      }
      if (textSupportRatio(bullet, supportedText) < 0.35) {
        issues.push(issue(
          "error",
          "claim_content_mismatch",
          "The bullet is not substantively supported by its mapped claim text.",
          bulletLocation
        ));
      }
      for (const token of unsupportedNumericTokens(bullet, supportedText)) {
          issues.push(issue(
            "error",
            "unsupported_number",
            `Numeric claim "${token}" is not present in the mapped source claims.`,
            bulletLocation
          ));
      }
    }
  }

  const skillMappings = new Map(
    (resume.provenance?.skills || []).map((mapping) => [normalize(mapping.skill), mapping])
  );
  const displayedSkills = [...(resume.skills_primary || []), ...(resume.skills_secondary || [])];
  // A vetoed-to-empty vocabulary is a deliberate configuration, not a missing
  // input; only an absent bank should report the input error.
  const hasVocabularySource = Boolean((bank?.units || []).length)
    || Boolean((identity?.legacy_skills || []).length);
  if (displayedSkills.length && !hasVocabularySource) {
    issues.push(issue(
      "error",
      "no_skill_vocabulary",
      "No skill vocabulary is available: pass the accomplishment bank, or the persona has no units.",
      "skills"
    ));
  }
  for (const skill of displayedSkills) {
    const normalizedSkill = normalize(skill);
    if (hasVocabularySource && !vocabulary.has(skill)) {
      issues.push(issue(
        "error",
        "skill_not_in_vocabulary",
        `Skill "${skill}" is not demonstrated by any accomplishment unit, or is vetoed in the identity record.`,
        "skills"
      ));
    }
    const mapping = skillMappings.get(normalizedSkill);
    if (!mapping) {
      issues.push(issue("error", "unmapped_skill", `Skill "${skill}" requires claim provenance.`, "skills"));
      continue;
    }
    for (const claimId of mapping.claimIds) {
      const claim = claimById.get(claimId);
      if (!claim) {
        issues.push(issue("error", "unknown_claim", `Claim "${claimId}" does not exist.`, `skill:${skill}`));
      } else if (claim.status !== "verified") {
        issues.push(issue("error", "unverified_claim", `Claim "${claimId}" is ${claim.status}.`, `skill:${skill}`));
      } else {
        const disclosureIssue = claimDisclosureIssue({
          claimId,
          authorization: renderAuthorization(claim),
          location: `skill:${skill}`,
        });
        if (disclosureIssue) {
          issues.push(disclosureIssue);
        }
      }
    }
    const skillEvidence = mapping.claimIds
      .map((claimId) => claimById.get(claimId))
      .filter(Boolean)
      .map(renderableFact)
      .join(" ");
    const skillCanonicalTerms = canonicalSkillsInText(skill).map((match) => match.canonicalId);
    const unsupportedSkillTerms = unsupportedCanonicalTerms(skill, skillEvidence);
    if (
      unsupportedSkillTerms.length ||
      (skillCanonicalTerms.length === 0 && textSupportRatio(skill, skillEvidence) < 0.5)
    ) {
      issues.push(issue(
        "error",
        "skill_claim_mismatch",
        `Mapped claims do not substantively support skill "${skill}".`,
        `skill:${skill}`
      ));
    }
  }

  if (resume.summary) {
    const sentences = splitSummarySentences(resume.summary);
    const rawMappings = resume.provenance?.summary || [];
    const mappingByIndex = new Map();
    for (const mapping of rawMappings) {
      if (mappingByIndex.has(mapping.sentenceIndex)) {
        issues.push(issue(
          "error",
          "duplicate_summary_sentence_mapping",
          `Summary sentence ${mapping.sentenceIndex} has more than one provenance mapping.`,
          `summary.sentences[${mapping.sentenceIndex}]`
        ));
      }
      mappingByIndex.set(mapping.sentenceIndex, mapping);
    }
    if (sentences.length < 2 || sentences.length > 3) {
      issues.push(issue(
        "error",
        "summary_sentence_count",
        "The summary must contain 2-3 natural sentences.",
        "summary"
      ));
    }
    const wordCount = summaryWordCount(resume.summary);
    if (wordCount < 40 || wordCount > 70) {
      issues.push(issue(
        "warning",
        "summary_length_heuristic",
        `The summary is ${wordCount} words; 40-70 words is an editorial heuristic, not a release gate.`,
        "summary"
      ));
    }
    if (!/\b(?:engineer|engineering|developer|architect)\b/i.test(sentences[0] || "")) {
      issues.push(issue(
        "error",
        "summary_identity_missing",
        "The opening sentence must establish an engineering identity.",
        "summary.sentences[0]"
      ));
    }
    if (
      /^(?:(?:senior|staff|principal)\s+)?(?:(?:software|frontend|front-end|backend|back-end|full-stack|full stack|platform|data|machine learning|infrastructure|site reliability)\s+)?(?:engineer|developer|architect)\s+(?:building|developing|creating|designing|delivering|working|leading)\b/i
        .test(sentences[0] || "")
    ) {
      issues.push(issue(
        "error",
        "summary_generic_gerund_opener",
        "Do not open with a generic title plus gerund.",
        "summary.sentences[0]"
      ));
    }

    const normalizedSummary = normalizeSummaryFragment(resume.summary);
    const normalizedHeadline = normalizeSummaryFragment(resume.ats_title);
    const normalizedTargetRole = normalizeSummaryFragment(resume.target_role);
    if (
      (normalizedHeadline && normalizedSummary.startsWith(normalizedHeadline)) ||
      (normalizedTargetRole && normalizedSummary.startsWith(normalizedTargetRole))
    ) {
      issues.push(issue(
        "error",
        "summary_repeats_headline",
        "The summary must not repeat the headline or target role verbatim.",
        "summary.sentences[0]"
      ));
    }

    const verifiedTitles = [
      ...(identity.experience || []).map((entry) => entry.role),
      ...(identity.other_experience_compacted || []).map((entry) => entry.role),
      ...(identity.experience || []).flatMap((entry) =>
        (entry.progression || []).flatMap((step) => [step.label, step.externalLabel])
      ),
    ].filter(Boolean).join(" ");
    for (const level of ["Senior", "Staff", "Principal"]) {
      if (
        new RegExp(`\\b${level}\\b`, "i").test(resume.summary) &&
        !new RegExp(`\\b${level}\\b`, "i").test(verifiedTitles)
      ) {
        issues.push(issue(
          "error",
          "summary_unverified_seniority",
          `${level} may appear in the summary only when it appears in a verified title.`,
          "summary"
        ));
      }
    }

    const displayedSkills = [...(resume.skills_primary || []), ...(resume.skills_secondary || [])];
    const openingSkillMentions = displayedSkills.filter((skill) =>
      normalizeSummaryFragment(sentences[0]).includes(normalizeSummaryFragment(skill))
    );
    if (
      openingSkillMentions.length >= 3 &&
      ((sentences[0].match(/,/g) || []).length >= 2 ||
        /\b(?:skills|expertise|proficient|experience in|hands-on work in)\b/i.test(sentences[0]))
    ) {
      issues.push(issue(
        "error",
        "summary_restates_skills",
        "The summary opening restates the skills section instead of using stack terms inside an identity narrative.",
        "summary.sentences[0]"
      ));
    }
    if (sentences.some((sentence) =>
      (sentence.match(/,/g) || []).length >= 3 &&
      !SUMMARY_ACTION_VERBS.test(sentence)
    )) {
      issues.push(issue(
        "error",
        "summary_capability_inventory",
        "The summary contains a comma-linked capability inventory.",
        "summary"
      ));
    }

    if (rawMappings.length !== sentences.length) {
      issues.push(issue(
        "error",
        "unmapped_summary",
        "Every summary sentence requires clause-level provenance.",
        "summary"
      ));
    }
    for (const [sentenceIndex, sentence] of sentences.entries()) {
      const mapping = mappingByIndex.get(sentenceIndex);
      const sentenceLocation = `summary.sentences[${sentenceIndex}]`;
      if (!mapping) continue;
      if (normalizeSummaryFragment(mapping.text) !== normalizeSummaryFragment(sentence)) {
        issues.push(issue(
          "error",
          "summary_sentence_text_mismatch",
          "Summary provenance sentence text must match the rendered sentence.",
          sentenceLocation
        ));
      }

      const mappedClauseText = (mapping.clauses || [])
        .map((clause) => normalizeSummaryFragment(clause.text))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (mappedClauseText !== normalizeSummaryFragment(sentence)) {
        issues.push(issue(
          "error",
          "summary_clause_coverage",
          "Summary clauses must cover the full sentence in order so no material phrase is left globally mapped.",
          sentenceLocation
        ));
      }

      for (const [clauseIndex, clause] of (mapping.clauses || []).entries()) {
        const clauseLocation = `${sentenceLocation}.clauses[${clauseIndex}]`;
        const provenanceIssues = claimProvenanceIssues(clause.claimIds, claimById, clauseLocation);
        issues.push(...provenanceIssues);
        const mappedClaims = clause.claimIds
          .map((claimId) => claimById.get(claimId))
          .filter(Boolean);
        if (!provenanceIssues.length) {
          issues.push(...summaryClauseContentIssues(clause.text, mappedClaims, clauseLocation));
        }

        for (const claimId of clause.claimIds) {
          const carryingUnits = (bank?.units || [])
            .filter((unit) => unit.claimIds.includes(claimId))
            .map((unit) => unit.id);
          if (
            carryingUnits.length &&
            !carryingUnits.some((unitId) => (clause.unitIds || []).includes(unitId))
          ) {
            issues.push(issue(
              "error",
              "summary_claim_unit_unmapped",
              `Summary claim "${claimId}" belongs to an accomplishment unit, but the clause maps none of its carrying units: ${carryingUnits.join(", ")}.`,
              clauseLocation
            ));
          }
        }
        for (const unitId of clause.unitIds || []) {
          const unit = (bank?.units || []).find((entry) => entry.id === unitId);
          if (!unit) {
            issues.push(issue(
              "error",
              "unknown_summary_unit",
              `Summary clause references unknown accomplishment unit "${unitId}".`,
              clauseLocation
            ));
            continue;
          }
          if (!clause.claimIds.some((claimId) => unit.claimIds.includes(claimId))) {
            issues.push(issue(
              "error",
              "summary_unit_claim_mismatch",
              `Summary unit "${unitId}" contains none of the clause's mapped claims.`,
              clauseLocation
            ));
          }
        }
        if ((clause.unitIds || []).length > 1 && SUMMARY_LIFECYCLE_MERGE.test(clause.text)) {
          issues.push(issue(
            "error",
            "summary_unit_lifecycle_merge",
            "A summary clause may not merge separate accomplishment units into one lifecycle.",
            clauseLocation
          ));
        }
      }
    }

    for (const index of mappingByIndex.keys()) {
      if (index >= sentences.length) {
        issues.push(issue(
          "error",
          "summary_sentence_index_out_of_range",
          `Summary provenance references sentence ${index}, but the summary has ${sentences.length} sentences.`,
          `summary.sentences[${index}]`
        ));
      }
    }

    const summaryPlan = applicationStrategy?.firstPagePlan?.summaryPlan || null;
    issues.push(...summaryPlanCoverageIssues({
      plan: summaryPlan,
      sentenceMappings: sentences.map((_, index) => mappingByIndex.get(index)),
    }));
    if (summaryPlan) {
      const expectedSentenceCount = summaryPlan.differentiator ? 3 : 2;
      if (sentences.length !== expectedSentenceCount) {
        issues.push(issue(
          "error",
          "summary_plan_sentence_count",
          `The selected summary plan requires exactly ${expectedSentenceCount} sentences.`,
          "summary"
        ));
      }
    }

    const recentMapping = mappingByIndex.get(1);
    const recentText = recentMapping?.text || sentences[1] || "";
    const recentUnitId = summaryPlan?.recentProof?.primaryUnitId;
    const recentHasUnit = recentUnitId
      ? (recentMapping?.clauses || []).some((clause) => clause.unitIds.includes(recentUnitId))
      : (recentMapping?.clauses || []).some((clause) => clause.unitIds.length > 0);
    if (!recentHasUnit || !SUMMARY_ACTION_VERBS.test(recentText)) {
      issues.push(issue(
        "error",
        "summary_concrete_proof_missing",
        "The second sentence must present one concrete accomplishment with calibrated contribution language.",
        "summary.sentences[1]"
      ));
    }

    const recentUnit = (bank?.units || []).find((unit) => unit.id === recentUnitId);
    if (
      /\bhands-on work in\b/i.test(resume.summary) &&
      ["sole_owner", "tech_lead"].includes(recentUnit?.contribution)
    ) {
      issues.push(issue(
        "error",
        "summary_weak_ownership_phrase",
        'Do not use "hands-on work in" when the selected unit supports ownership language.',
        "summary"
      ));
    }
  }

  const unsupportedTitleTerms = unsupportedCanonicalTerms(
    resume.ats_title,
    `${vocabulary.labels().join(" ")} ${resume.target_role}`
  );
  // Advisory, not blocking. This rule asserted that the headline must contain
  // `target_role` — but `target_role` is another free-text resume field that is
  // never checked against the posting, so the rule compared the resume to
  // itself and enforced echoing rather than accuracy. It also failed in the
  // dangerous direction: a substring test passes a headline that *inflates*
  // seniority ("Senior X" contains "X") while blocking a truthful one that
  // drops a domain word. At `error` severity it could force the top line of the
  // document to adopt an employer's narrow reading of a term that claim
  // validation refuses to assert anywhere in the body — the integrity rules and
  // this formatting rule pulling opposite ways, with the formatting rule
  // winning because it was the one that blocked.
  //
  // `error` is the budget reserved for fabricated claims, unsupported skills
  // and altered employment facts. A contested formatting convention does not
  // get to spend it. Keyword retrieval is measured over the whole document
  // anyway, which `score-resume-ats.js` already does.
  if (resume.ats_title && !normalize(resume.ats_title).includes(normalize(resume.target_role))) {
    issues.push(issue(
      "warning",
      "ats_title_role_mismatch",
      "The headline does not restate the target role. Advisory: ATS keyword search is full-text " +
      "over the whole document, so this costs no retrieval. Restate it only if it is also true.",
      "ats_title"
    ));
  }
  if (unsupportedTitleTerms.length) {
    issues.push(issue(
      "error",
      "ats_title_unsupported_skill",
      `ATS title contains unsupported skills: ${unsupportedTitleTerms.join(", ")}.`,
      "ats_title"
    ));
  }

  for (const mapping of resume.provenance?.headline || []) {
    for (const claimId of mapping.claimIds || []) {
      const claim = claimById.get(claimId);
      if (!claim || claim.status !== "verified") continue;
      const disclosureIssue = claimDisclosureIssue({
        claimId,
        authorization: renderAuthorization(claim),
        location: "ats_title",
        subject: "Headline claim",
      });
      if (disclosureIssue) {
        issues.push(disclosureIssue);
      }
    }
  }

  // Headline diagnostics. Advisory by construction: every signal about a
  // headline is lexical, and lexical coverage may never block a release.
  // Requirement collisions read the structured job spec and the ledger, never
  // ATS scoring, whose searchable text includes `ats_title` itself.
  issues.push(...analyzeHeadline({
    atsTitle: resume.ats_title,
    targetRole: resume.target_role,
    resume,
    ledger,
    jobSpec,
  }));

  // Education must match the identity record exactly: a degree is not a
  // per-job selection, and silently dropping one misrepresents the record.
  {
    const actual = normalizedMultiset(resume.education || []);
    const expected = normalizedMultiset(identity.education || []);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      // Every entry the resume renders must be supported, not merely the ones
      // that differ. A resume that dropped a degree renders nothing new, and
      // testing only the difference would classify it stale on an empty set.
      const remedy = identitySectionRemedy(resume.education || []);
      issues.push(issue(
        "error",
        "identity_section_mismatch",
        "education must match the identity record exactly; rebuild the identity record if the source record changed." +
        (remedy ? staleSuffix() : ""),
        "education",
        remedy
      ));
    }
  }

  // Projects, certifications and awards are a catalog the tailor selects from.
  // The resume may carry any subset, but never an entry the identity record
  // does not contain -- that is the anti-fabrication guarantee. Omission is a
  // tailoring decision and is checked by strategy, not here.
  for (const field of ["projects", "certifications", "awards_or_contributions"]) {
    const permitted = new Map();
    for (const entry of identity[field] || []) {
      const key = catalogKey(entry);
      permitted.set(key, (permitted.get(key) || 0) + 1);
    }
    const unsupported = [];
    const unsupportedEntries = [];
    for (const entry of resume[field] || []) {
      const key = catalogKey(entry);
      const remaining = permitted.get(key) || 0;
      if (remaining === 0) {
        unsupported.push(entry?.name || entry?.title || key.slice(0, 60));
        unsupportedEntries.push(entry);
      } else {
        permitted.set(key, remaining - 1);
      }
    }
    if (unsupported.length) {
      const remedy = identitySectionRemedy(unsupportedEntries);
      issues.push(issue(
        "error",
        "identity_section_unsupported",
        `${field} contains entries absent from the identity record: ${unsupported.join(", ")}. ` +
        `Rebuild the identity record if the source record changed.` +
        (remedy ? staleSuffix() : ""),
        field,
        remedy
      ));
    }
  }

  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");
  return {
    // Unchanged on purpose. The release gate reads `valid`, and a stale record
    // is still an error, so classification cannot widen what may be sent.
    valid: errors.length === 0,
    errorCount: errors.length,
    // Counted by severity rather than by subtraction. `info` findings say
    // "here is something you cannot see", not "here is something wrong", and
    // folding them into the warning count would inflate every run that adds a
    // neutral observation.
    warningCount: warnings.length,
    infoCount: issues.length - errors.length - warnings.length,
    // What the caller may do now. `review_only` means every error is
    // recoverable workflow debt, so review work can continue while carrying a
    // visible stale marker. It is never `send_ready`: it is reported only when
    // errors exist, and errors keep `valid` false.
    state: classifyRunState(issues),
    // One packet for every stale record, so a rebuild is planned once rather
    // than rediscovered one failed run at a time.
    rebuildPacket: rebuildPacket(issues),
    issues,
  };
}
