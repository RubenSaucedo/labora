import crypto from "node:crypto";

/**
 * Findings replace blockers.
 *
 * The old release gate had one bucket. A model's opinion that a candidate is
 * weak and a rendered document that does not exist both landed in
 * `hardBlockers`, and both stopped the operator identically. That is the
 * defect issue #89 names: it gives heuristics and simulations authority over
 * someone's own career history.
 *
 * A finding says what Labora established and what it did not, offers the
 * smallest next action, and never decides. The operator decides.
 */

/**
 * How a statement came to be believed. This is the distinction the old model
 * could not draw: it knew `valid` and `not valid`, so the only way to record
 * "the operator says this is true and I cannot check it" was to fail.
 *
 * - `verified`      the current process established it from mapped evidence
 * - `user_attested` the operator confirms it; Labora cannot independently check
 * - `uncertain`     evidence or model judgment is inconclusive
 * - `unsupported`   the current corpus does not support it
 *
 * None of these prevents generation. `unsupported` is a fact about the corpus,
 * never about the person -- the evidence may be private, undigitised, or simply
 * not mapped yet.
 */
export const FINDING_STATUSES = ["verified", "user_attested", "uncertain", "unsupported"];

/**
 * The standing menu. Every finding offers the operator a way forward, because a
 * warning that repeats with no route attached is how a tool trains people to
 * ignore it.
 */
export const STANDARD_ACTIONS = [
  "Ask the operator for corroborating evidence",
  "Retrieve an approved source",
  "Use narrower wording",
  "Remove the statement",
  "Accept the finding and continue",
];

/**
 * Identity is derived from content, never from position.
 *
 * An approval binds to a set of finding IDs. If IDs were ordinal -- `finding-3`
 * -- then adding one unrelated finding would renumber the rest, and a recorded
 * approval of `finding-3` would silently come to mean a different statement
 * than the one the operator read. Deriving the ID from what the finding is
 * about makes that impossible: a different concern is a different ID, and an
 * approval that no longer matches is visibly stale rather than quietly wrong.
 */
export function findingId({ source, code, location = "" }) {
  const digest = crypto
    .createHash("sha256")
    .update(`${source}|${code}|${location}`)
    .digest("hex");
  return `f-${digest.slice(0, 12)}`;
}

export function makeFinding({
  source,
  code,
  status,
  finding,
  location = "",
  basis = [],
  suggestedActions = STANDARD_ACTIONS,
}) {
  if (!FINDING_STATUSES.includes(status)) {
    throw new Error(`unknown finding status: ${status}`);
  }
  return {
    id: findingId({ source, code, location }),
    source,
    code,
    status,
    finding,
    location,
    basis: [...basis],
    suggestedActions: [...suggestedActions],
  };
}

/**
 * Two findings with the same identity are the same concern seen twice -- a
 * claim heuristic and a judge can both notice one weak bullet. Reporting it
 * twice would make the operator acknowledge the same thing twice, and would
 * make the approval set depend on how many stages happened to look.
 */
export function dedupeFindings(findings) {
  const byId = new Map();
  for (const finding of findings) {
    if (!byId.has(finding.id)) byId.set(finding.id, finding);
  }
  return [...byId.values()];
}

/**
 * The severity ordering used for display only. It orders attention; it does not
 * order authority, because none of these stops anyone.
 */
const RANK = { unsupported: 0, uncertain: 1, user_attested: 2, verified: 3 };

export function sortFindings(findings) {
  return [...findings].sort((a, b) =>
    (RANK[a.status] - RANK[b.status]) || a.source.localeCompare(b.source) || a.code.localeCompare(b.code)
  );
}

export function summarizeFindings(findings) {
  const counts = Object.fromEntries(FINDING_STATUSES.map((status) => [status, 0]));
  for (const finding of findings) counts[finding.status] += 1;
  return counts;
}
