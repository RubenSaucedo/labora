import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ZEvidenceManifest, basisIsAdmissible } from "../schemas/evidence-manifest.js";

export const MANIFEST_RELATIVE = path.join("evidence", "PROVENANCE.json");

function sha256(file) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

const normalizeHash = (value) => String(value || "").replace(/^sha256:/i, "").toLowerCase();

export function loadManifest(personaRoot) {
  const file = path.join(personaRoot, MANIFEST_RELATIVE);
  if (!fs.existsSync(file)) return { present: false, sources: new Map(), issues: [] };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return { present: true, sources: new Map(), issues: [{ code: "manifest_unparseable", message: err.message }] };
  }
  const parsed = ZEvidenceManifest.safeParse(raw);
  if (!parsed.success) {
    return {
      present: true,
      sources: new Map(),
      issues: parsed.error.issues.map((i) => ({
        code: "manifest_invalid",
        message: `${i.path.join(".")}: ${i.message}`,
      })),
    };
  }
  const issues = [];
  const sources = new Map();
  for (const entry of parsed.data.sources) {
    // A tool cannot decide a document was employer-authored, and an operator's
    // word is not what makes a snapshot machine-retrievable. Rejecting the
    // impossible pairings is what prevents accidental laundering.
    if (!basisIsAdmissible(entry.sourceKind, entry.classificationBasis)) {
      issues.push({
        code: "classification_basis_inadmissible",
        message: `"${entry.path}" declares sourceKind "${entry.sourceKind}" with classificationBasis "${entry.classificationBasis}", which cannot produce that determination.`,
      });
      continue;
    }
    sources.set(entry.path, entry);
  }
  return { present: true, sources, issues, persona: parsed.data.persona };
}

// Only the two cases a tool can determine on its own. Everything else is
// `undeclared` rather than guessed: inferring the STRONGEST tier from a
// directory name is exactly the defect this replaces.
function toolDerived(relativePath) {
  if (/(^|\/)repositories\.md$/.test(relativePath)) {
    return { sourceKind: "repository_snapshot", classificationBasis: "tool_derived", recheckability: null };
  }
  if (/(^|\/)observations\.json$/.test(relativePath)) {
    return { sourceKind: "observation_record", classificationBasis: "tool_derived", recheckability: null };
  }
  // The persona wrote these two by definition, so no declaration is needed and
  // none would add information.
  if (/^profile\/(background|career)\.md$/.test(relativePath)) {
    return { sourceKind: "candidate_statement", classificationBasis: "tool_derived", recheckability: "operator_gated" };
  }
  return null;
}

/**
 * Resolves provenance for one source reference.
 *
 * Three staleness cases, deliberately distinguished. Collapsing them into a
 * silent fallback would either hide a real integrity failure or block a
 * candidate over metadata.
 *
 *   1. evidence bytes differ from the ledger's own `fileHash` -> integrity
 *      error, already caught upstream by validate-resume-claims.
 *   2. bytes match the ledger but the manifest entry is for other bytes ->
 *      `stale`: the claim is still grounded, the metadata needs a rebuild.
 *   3. no entry at all -> `undeclared`: metadata debt, never an evidence grade.
 */
export function resolveProvenance(sourcePath, personaRoot, manifest) {
  const relative = path.relative(personaRoot, path.resolve(personaRoot, sourcePath)).split(path.sep).join("/");
  const entry = manifest.sources.get(relative) || manifest.sources.get(sourcePath);
  const onDisk = sha256(path.resolve(personaRoot, sourcePath));

  if (entry) {
    if (onDisk && normalizeHash(entry.contentHash) !== onDisk) {
      return { state: "stale", relative, declared: entry, sourceKind: entry.sourceKind, classificationBasis: entry.classificationBasis, recheckability: entry.recheckability };
    }
    return { state: "declared", relative, declared: entry, sourceKind: entry.sourceKind, classificationBasis: entry.classificationBasis, recheckability: entry.recheckability };
  }

  const derived = toolDerived(relative);
  if (derived) return { state: "derived", relative, ...derived };

  return { state: "undeclared", relative, sourceKind: null, classificationBasis: null, recheckability: null };
}

export const SOURCE_KIND_MEANING = {
  candidate_statement: "The candidate wrote it. A lead worth confirming, not a verification.",
  employer_document: "The operator identifies this as an employer-authored document. labora cannot authenticate authorship.",
  third_party_document: "The operator identifies this as written by a third party.",
  observation_record: "A validated record of what a live system did when acted upon.",
  repository_snapshot: "A tool read it from a repository; re-runnable and diffable.",
};

// Wording matters here. `operator_gated` is where most real production work
// lives -- private repos, NDA'd systems, internal tooling. It is an access
// property, not a strength property, and a reviewer who reads it as "weak" has
// been misled by the tool.
export const RECHECKABILITY_MEANING = {
  public: "A reviewer can re-check this unaided, from the public internet.",
  operator_gated: "Re-checkable through access the candidate is permitted to provide, such as a demo or walkthrough. Restricted access is not a negative signal and does not reduce claim validity.",
  point_in_time: "Recorded once, on a date, and not currently re-checkable.",
};
