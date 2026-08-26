/**
 * Why a validation error happened, not just that it happened.
 *
 * The claim validator has always been right to refuse a resume whose content
 * outruns the verified ledger. It was wrong to report two unrelated situations
 * in the same shape:
 *
 *   1. the evidence does not support what the resume says -- a factual defect
 *      with no safe next step except changing the resume;
 *   2. `profile/generated/` was built from a different version of the human
 *      authored source than the one on disk -- recoverable workflow debt with a
 *      known owner and a known command.
 *
 * Collapsing the second into the first made every agent read a non-zero exit as
 * "stop", so review work that never claimed release readiness stopped too. That
 * is how an assurance tool becomes a blocker: not by being wrong, but by
 * refusing to say which kind of wrong it found.
 *
 * Classifying does not weaken the gate. `valid` still means zero errors, and a
 * stale record is still an error. It only tells the caller what may proceed.
 */

export const UNSUPPORTED_ASSERTION = "unsupported_assertion";
export const STALE_DERIVED_RECORD = "stale_derived_record";

/**
 * What a stale generated record permits and forbids.
 *
 * `blocks` is deliberately everything that could be mistaken for a validated
 * result -- release, the judges, and both delivery containers. `allows` is
 * everything that helps a human make progress while carrying a visible stale
 * marker.
 */
export const STALE_RECORD_REMEDY = Object.freeze({
  class: STALE_DERIVED_RECORD,
  owner: "profile-builder",
  requiredAction: "rebuild_profile",
  blocks: Object.freeze(["release", "judges", "docx", "pdf"]),
  allows: Object.freeze(["content_review", "markdown_review", "preview_draft"]),
});

/**
 * The run state a caller should act on.
 *
 * `review_only` exists so an orchestrator has a name for "not releasable, but
 * not finished either". It never clears the ledger: it is reported only
 * when errors exist, and errors keep `valid` false.
 */
export function classifyRunState(issues) {
  const errors = (issues || []).filter((item) => item.severity === "error");
  if (!errors.length) return "valid";
  const everyErrorIsStale = errors.every((item) => item.class === STALE_DERIVED_RECORD);
  return everyErrorIsStale ? "review_only" : "invalid";
}

/**
 * One rebuild packet for every stale record, so the operator learns the whole
 * cost of the rebuild at once instead of rediscovering it one failed run at a
 * time. Deterministic: records are sorted so two runs over the same inputs
 * produce byte-identical packets.
 */
export function rebuildPacket(issues) {
  const stale = (issues || [])
    .filter((item) => item.class === STALE_DERIVED_RECORD)
    .map((item) => ({ code: item.code, location: item.location, message: item.message }))
    .sort((a, b) => `${a.code}${a.location}`.localeCompare(`${b.code}${b.location}`));
  if (!stale.length) return null;
  return {
    owner: STALE_RECORD_REMEDY.owner,
    requiredAction: STALE_RECORD_REMEDY.requiredAction,
    blocks: [...STALE_RECORD_REMEDY.blocks],
    allows: [...STALE_RECORD_REMEDY.allows],
    records: stale,
  };
}
