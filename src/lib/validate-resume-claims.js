import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalSkillsInText } from "./skill-aliases.js";
import { skillVocabulary } from "./skill-vocabulary.js";
import { analyzeHeadline } from "./headline.js";
import { validateObservations } from "./validate-observations.js";
import { loadManifest, resolveProvenance } from "./evidence-provenance.js";

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

function issue(severity, code, message, location = "") {
  return { severity, code, message, location };
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
    if (claim.disclosure === "internal_only") {
      found.push(issue(
        "error",
        "confidential_claim_rendered",
        `Claim "${claimId}" is internal_only and may not ground rendered resume content.`,
        location
      ));
    }
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
  const claimEvidence = new Map();
  const readExcerpts = (sources, sourceLocation) => {
    const excerpts = [];
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
      if (sha256(sourcePath) !== source.fileHash) {
        issues.push(issue("error", "source_hash_mismatch", `Source "${source.path}" changed after claim verification.`, sourceLocation));
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
    return excerpts;
  };

  for (const claim of ledger.claims) {
    const sourceLocation = `claim:${claim.id}`;
    const excerpts = readExcerpts(claim.sources, sourceLocation);
    claimEvidence.set(claim.id, excerpts.join("\n"));
    if (!excerpts.some((excerpt) => excerptSupports(claim.fact, excerpt))) {
      issues.push(issue(
        "error",
        "claim_source_mismatch",
        `Claim "${claim.id}" is not substantively supported by its referenced source excerpt.`,
        sourceLocation
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
      const generalizationEvidence = [claim.fact, ...readExcerpts(claim.externalSources, sourceLocation)].join("\n");
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
      issues.push(issue(
        "error",
        "identity_experience_unproven",
        result.empty
          ? `Identity experience "${label}" carries no role, company or period to ground. Fill it in from an approved source, or remove the entry.`
          : `Identity experience "${label}" is not grounded in an approved source excerpt: ${result.unsupported.join(", ")}. Add a source excerpt covering ${result.unsupported.length === 1 ? "that field" : "those fields"}, or correct the entry to match the evidence.`,
        `identity.experience:${label}`
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
      issues.push(...claimProvenanceIssues(claimIds, claimById, location));
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
      const rendered = step.disclosure !== "internal_only";
      if (!rendered) continue;

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
      // place whenever one is set, alongside `date`. Checking only `label`
      // leaves the rendered title and year free to say anything while the step
      // still resolves to a real, claim-backed promotion. Both must match the
      // identity record for the same reason company, role and period do.
      for (const field of ["externalLabel", "date"]) {
        if (normalize(step[field] || "") !== normalize(coreStep[field] || "")) {
          issues.push(issue(
            "error",
            "progression_identity_changed",
            `${field} must match the identity record for progression step "${step.label}".`,
            `${stepLocation}.${field}`
          ));
        }
      }

      // An internal ladder token is meaningless outside the company and may be
      // confidential, so a generalizable step must carry an external label.
      if (step.disclosure === "internal_generalizable" && !String(step.externalLabel || "").trim()) {
        issues.push(issue(
          "error",
          "progression_label_not_generalized",
          `Progression step "${step.label}" is internal_generalizable and requires an externalLabel to render.`,
          stepLocation
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
        if (claim.disclosure === "internal_only") {
          issues.push(issue(
            "error",
            "confidential_claim_rendered",
            `Claim "${claimId}" is internal_only and may not ground rendered resume content.`,
            bulletLocation
          ));
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
      } else if (claim.disclosure === "internal_only") {
        issues.push(issue(
          "error",
          "confidential_claim_rendered",
          `Claim "${claimId}" is internal_only and may not ground rendered resume content.`,
          `skill:${skill}`
        ));
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

  for (const claimId of resume.provenance?.summaryClaimIds || []) {
    const claim = claimById.get(claimId);
    if (!claim) {
      issues.push(issue("error", "unknown_claim", `Summary claim "${claimId}" does not exist.`, "summary"));
    } else if (claim.status !== "verified") {
      issues.push(issue("error", "unverified_claim", `Summary claim "${claimId}" is ${claim.status}.`, "summary"));
    } else if (claim.disclosure === "internal_only") {
      issues.push(issue(
        "error",
        "confidential_claim_rendered",
        `Summary claim "${claimId}" is internal_only and may not ground rendered resume content.`,
        "summary"
      ));
    }
  }

  if (resume.summary) {
    const summaryClaims = (resume.provenance?.summaryClaimIds || [])
      .map((claimId) => claimById.get(claimId))
      .filter(Boolean);
    const summaryEvidence = summaryClaims.map(renderableFact).join(" ");
    if (!summaryClaims.length) {
      issues.push(issue("error", "unmapped_summary", "The summary requires verified claim provenance.", "summary"));
    } else {
      const unsupportedTerms = unsupportedCanonicalTerms(resume.summary, summaryEvidence);
      const unsupportedNames = unsupportedNamedTerms(resume.summary, summaryEvidence);
      const unsupportedNumbers = unsupportedNumericTokens(resume.summary, summaryEvidence);
      if (
        unsupportedTerms.length ||
        unsupportedNames.length ||
        unsupportedNumbers.length ||
        textSupportRatio(resume.summary, summaryEvidence) < 0.3
      ) {
        issues.push(issue(
          "error",
          "summary_claim_mismatch",
          "The summary contains content not supported by its mapped claims.",
          "summary"
        ));
      }
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
      issues.push(issue(
        "error",
        "identity_section_mismatch",
        "education must match the identity record exactly; rebuild the identity record if the source record changed.",
        "education"
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
    for (const entry of resume[field] || []) {
      const key = catalogKey(entry);
      const remaining = permitted.get(key) || 0;
      if (remaining === 0) {
        unsupported.push(entry?.name || entry?.title || key.slice(0, 60));
      } else {
        permitted.set(key, remaining - 1);
      }
    }
    if (unsupported.length) {
      issues.push(issue(
        "error",
        "identity_section_unsupported",
        `${field} contains entries absent from the identity record: ${unsupported.join(", ")}. Rebuild the identity record if the source record changed.`,
        field
      ));
    }
  }

  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");
  return {
    valid: errors.length === 0,
    errorCount: errors.length,
    // Counted by severity rather than by subtraction. `info` findings say
    // "here is something you cannot see", not "here is something wrong", and
    // folding them into the warning count would inflate every run that adds a
    // neutral observation.
    warningCount: warnings.length,
    infoCount: issues.length - errors.length - warnings.length,
    issues,
  };
}
