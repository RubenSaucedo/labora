import { z } from "zod";

// The evidence provenance manifest: `evidence/PROVENANCE.json`.
//
// It exists because two unrelated jobs were being done by one directory name.
// `evidence/performance-reviews/` was the only place a document could ground a
// claim, so everything was filed there; the renderer then read that same path
// as proof an employer had written it. Self-extracted and self-observed
// material was reported as employer-attested, and nothing looked broken.
//
// Provenance is therefore DECLARED here, never inferred from a location. The
// manifest is BUILD INPUT: `profile-builder` resolves it into the claim ledger,
// and the review surface renders the ledger's snapshot. Reading it live would
// let a classification change without a rebuild -- editing `sourceKind` does
// not change the evidence bytes, so no staleness check would ever fire.

// What the source IS and who authored it. A closed class, unlike the unbounded
// vocabulary a "document type" field would need.
export const ZSourceKind = z.enum([
  "candidate_statement",
  "employer_document",
  "third_party_document",
  "observation_record",
  "repository_snapshot",
]);

// Who can re-verify it, and when. Deliberately the same axis as the observation
// record's tiers. This is NOT a strength ranking and must never be sorted,
// scored, or weighted -- see PHILOSOPHY.md.
export const ZRecheckability = z.enum([
  "public",
  "operator_gated",
  "point_in_time",
]);

// How the classification was arrived at. The renderer needs this to say "the
// operator identifies this as an employer document" rather than "an employer
// verified this" -- labora cannot authenticate authorship and must not imply
// that it did.
export const ZClassificationBasis = z.enum([
  "tool_derived",
  "operator_declared",
  "legacy_unknown",
]);

// A tool cannot determine that a document was written by an employer, and an
// operator's word is not what makes a repository snapshot machine-retrievable.
// Rejecting the impossible pairings is what stops accidental laundering, which
// is the actual failure in #9 -- not a malicious operator, who controls the
// whole corpus anyway and cannot be defended against here.
const ADMISSIBLE = {
  candidate_statement: ["operator_declared"],
  employer_document: ["operator_declared"],
  third_party_document: ["operator_declared"],
  observation_record: ["tool_derived"],
  repository_snapshot: ["tool_derived"],
};

export function basisIsAdmissible(sourceKind, classificationBasis) {
  if (classificationBasis === "legacy_unknown") return true;
  return (ADMISSIBLE[sourceKind] || []).includes(classificationBasis);
}

export const ZEvidenceSource = z.object({
  path: z.string().min(1),

  // Binds the classification to exact bytes. This proves freshness, never
  // authenticity: it says "this classification refers to these bytes", not
  // "an employer wrote them".
  contentHash: z.string().regex(/^(sha256:)?[a-f0-9]{64}$/i),

  sourceKind: ZSourceKind,
  classificationBasis: ZClassificationBasis,

  // Null for structured evidence that carries per-record recheckability of its
  // own. A single observations.json can hold public, operator-gated and
  // point-in-time findings at once, and flattening them to one file-level value
  // would misclassify some of the claims derived from it.
  recheckability: ZRecheckability.nullable().default(null),

  extraction: z.enum(["markdown", "pdf-text", "ocr", "manual"]).default("markdown"),

  // When the evidence DESCRIBES, not when it was imported. The two were
  // conflated by directory names like `performance-reviews/2025/` holding
  // material from 2020 onward.
  contentDate: z.string().min(4),
  capturedAt: z.string().min(4),

  // How restricted the SOURCE is. Distinct from a claim's `disclosure`, which
  // governs what may be printed: a private review can legitimately support a
  // public generalized accomplishment.
  sourceAccess: z.enum(["public", "operator_gated", "confidential"]).default("operator_gated"),

  note: z.string().default(""),
}).strict();

export const ZEvidenceManifest = z.object({
  schemaVersion: z.literal("1.0"),
  persona: z.string().min(1),
  sources: z.array(ZEvidenceSource).default([]),
}).strict();
