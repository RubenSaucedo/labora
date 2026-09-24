/**
 * The persona workspace layout, declared once.
 *
 * Before this module the same layout was asserted in four places that disagreed
 * with each other, so an operator could not answer "where does this belong?"
 * without reading agent contracts, and every doc edit re-opened a settled
 * question. The contract lives here and prose points at it.
 *
 * The layout got simpler when the claim ledger was removed. There used to be
 * three kinds of directory -- what a person wrote, what a stage generated, and
 * what claims were anchored to -- and the rules about which could be renamed
 * were load-bearing, because renaming a file silently invalidated every claim
 * that cited it by path and content hash. Nothing is anchored any more. A
 * person can reorganise their own folder without breaking anything.
 */

/** Who writes a path, and what that implies for the operator. */
export const OWNERSHIP = Object.freeze({
  /** A person writes it. It is canonical, and a tool must never rewrite it. */
  AUTHORED: "authored",
  /** A tool writes it. Deleting it is safe; it can always be produced again. */
  PRODUCED: "produced",
  /** Material captured from elsewhere, as-is. Neither authored nor derived. */
  CAPTURED: "captured",
});

/**
 * Directories permitted at a persona root.
 *
 * `optional` records that absence is normal, so the linter can distinguish
 * "this persona has no sources yet" from "this persona has a directory nobody
 * declared".
 */
export const PERSONA_DIRECTORIES = Object.freeze([
  {
    name: "profile",
    ownership: OWNERSHIP.AUTHORED,
    optional: false,
    purpose: "what the person told us about their career, in their words",
  },
  {
    name: "sources",
    ownership: OWNERSHIP.CAPTURED,
    optional: true,
    purpose: "material the person already had: old résumés, notes, reviews, exports",
  },
  {
    name: "applications",
    ownership: OWNERSHIP.PRODUCED,
    optional: true,
    purpose: "one directory per job, inputs and outputs together",
  },
  {
    name: "job-search",
    ownership: OWNERSHIP.PRODUCED,
    optional: true,
    purpose: "dated discovery runs",
  },
]);

/**
 * Files at `profile/` a person authors.
 *
 * All four are plain prose or a small preferences file, on purpose. They are
 * meant to be opened and edited by hand: this is the person's own account of
 * their career, and it is the only source of truth Labora has.
 */
export const AUTHORED_PROFILE_FILES = Object.freeze([
  "contact.md",
  "background.md",
  "career.md",
  "search-preferences.json",
]);

/**
 * The directory the claim ledger used to be compiled into.
 *
 * Recognised only so migration can tell a person it is no longer read. Nothing
 * writes it and nothing looks inside it.
 */
export const RETIRED_GENERATED_DIRS = Object.freeze([
  "profile/generated",
  ".labora/state/profile",
]);

/** The directory `sources/` replaced. Recognised so migration can move it. */
export const LEGACY_SOURCES_DIR = "evidence";

/** Lowercase ASCII kebab-case, the naming standard for authored paths. */
export function isKebabCase(segment) {
  return /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(segment);
}

/**
 * A path segment that is only a year.
 *
 * It reads as the year the material describes while it usually records the
 * import batch, so a directory named `2025/` ends up holding things from 2020
 * onward. Worth mentioning to a person; never worth refusing over.
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
