/**
 * The persona workspace layout, declared once.
 *
 * Before this module the same layout was asserted in at least four places that
 * disagreed with each other: the conventions skill described flat content-dated
 * evidence files *and* processing-stage directories in the same document, the
 * researcher agent permitted only capture-date directories, and the README and
 * evidence skill prescribed `raw/extracted/text/validations`. A reader had to
 * pick a winner, and every stage picked a different one.
 *
 * The cost of that is not tidiness. It is that an operator cannot answer "where
 * does this evidence belong?" or "which file may I edit?" without reading agent
 * contracts, and every doc edit re-opened a settled question.
 *
 * So the contract lives here, in code, and prose points at it. Two properties
 * matter more than the specific shapes:
 *
 *   - **Ownership is declared, not inferred.** Whether a path is authored by a
 *     human or produced by a stage is a fact about who may write it, and it is
 *     recorded rather than guessed from a file extension.
 *
 *   - **Recognition is not enforcement.** Claims anchor to path plus content
 *     hash plus line range, so renaming evidence re-anchors every claim that
 *     cites it. This module therefore *recognises* the legacy shapes as valid
 *     rather than reporting them as defects, and says which one is preferred
 *     for new material. Migration is a separate, explicit, reversible step.
 */

/** Who may write a path, and what that implies for the operator. */
export const OWNERSHIP = Object.freeze({
  /** A human writes it. It is canonical, and a tool must never rewrite it. */
  AUTHORED: "authored",
  /** A stage writes it. Deleting it is safe; hand-editing it is not. */
  GENERATED: "generated",
  /** Original bytes captured from elsewhere. Neither authored nor derived. */
  CAPTURED: "captured",
});

/**
 * Directories permitted at a persona root.
 *
 * `optional` records that absence is normal, so the linter can distinguish
 * "this persona has no evidence yet" from "this persona has a directory nobody
 * declared".
 */
export const PERSONA_DIRECTORIES = Object.freeze([
  { name: "profile", ownership: OWNERSHIP.AUTHORED, optional: false, purpose: "durable career facts the operator writes" },
  { name: "evidence", ownership: OWNERSHIP.CAPTURED, optional: true, purpose: "source material claims are grounded in" },
  { name: "applications", ownership: OWNERSHIP.GENERATED, optional: true, purpose: "one directory per job, inputs and outputs together" },
  { name: "job-search", ownership: OWNERSHIP.GENERATED, optional: true, purpose: "dated discovery runs" },
  { name: "career-issues", ownership: OWNERSHIP.AUTHORED, optional: true, purpose: "career-issue drafts, filed by a human" },
]);

/** Files at `profile/` a human authors. Everything else there is derived. */
export const AUTHORED_PROFILE_FILES = Object.freeze([
  "contact.md",
  "background.md",
  "career.md",
  "search-preferences.json",
]);

/**
 * Where compiled profile state lives today.
 *
 * It sits inside the authored tree, which is precisely the complaint: three
 * machine-owned ledgers and a fourth generated review surface are presented as
 * peers of the files the operator actually writes. The linter reports that as
 * an observation rather than a defect, because moving it is a migration.
 */
export const GENERATED_PROFILE_DIR = "profile/generated";

/**
 * Evidence package shapes, in preference order.
 *
 * `preferred` is the shape new material should use. The others are recognised
 * because personas already use them and their claims are anchored to those
 * exact paths.
 */
export const EVIDENCE_SHAPES = Object.freeze([
  {
    id: "dated-subject-package",
    preferred: true,
    example: "evidence/performance-reviews/2024-10-mid-year-review/evidence.md",
    describes: "one directory per evidence item, named for the date the evidence describes plus a subject slug",
  },
  {
    id: "processing-stage",
    preferred: false,
    example: "evidence/performance-reviews/{raw,extracted,text,validations}/<basename>.<ext>",
    describes: "one directory per pipeline stage, shared across every item",
  },
  {
    id: "capture-date",
    preferred: false,
    example: "evidence/repositories/2026-08-25/repositories.md",
    describes: "one directory per capture batch",
  },
]);

/**
 * A path segment that is only a year.
 *
 * It reads as the year the evidence describes while it almost always records
 * the import batch, so a directory named `2025/` ends up holding material from
 * 2020 onward. The manifest's `contentDate` and `capturedAt` are authoritative
 * either way; a path date never is.
 */
export function isBareYearSegment(segment) {
  return /^(19|20)\d{2}$/.test(segment);
}

/** A date with no subject attached: `2024-10`, `2024-10-05`. */
export function isBareDateSegment(segment) {
  return /^(19|20)\d{2}(-\d{2}){0,2}$/.test(segment);
}

/** `2024-10-mid-year-review` — a date that also says what it is about. */
export function isDatedSubjectSegment(segment) {
  return /^(19|20)\d{2}(-\d{2}){0,2}-[a-z0-9]+(-[a-z0-9]+)*$/.test(segment);
}

/** Lowercase ASCII kebab-case, the naming standard for authored paths. */
export function isKebabCase(segment) {
  return /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(segment);
}
