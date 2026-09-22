import fs from "node:fs";
import path from "node:path";

/**
 * The effective release state.
 *
 * `release.json` is written by the gate and can only say `review_ready` or
 * `generation_failed`. `release-approval.json` is written only by an explicit
 * operator action. This function combines them, and it is the only place the
 * word `operator_approved` is ever produced.
 *
 * Keeping the two in separate files is what makes the guarantee structural.
 * The gate cannot approve, because it never opens the approval file; and the
 * approval cannot silently outlive the thing it approved, because it names the
 * exact artifact hash and the exact findings that were on screen when the
 * operator decided.
 */

export const RELEASE_FILE = "release.json";
export const APPROVAL_FILE = "release-approval.json";

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

/**
 * Why an approval no longer applies. Each reason names what changed, because
 * "your approval is stale" without a cause is the kind of message that teaches
 * people to re-approve reflexively.
 */
export function approvalStatus(release, approval) {
  if (!approval) return { approved: false, reason: "no operator approval has been recorded" };
  if (!release?.artifact?.hash) {
    return { approved: false, reason: "no artifact exists to approve" };
  }
  if (approval.artifactHash !== release.artifact.hash) {
    return {
      approved: false,
      reason: "the artifact changed after it was approved; review and approve the new document",
    };
  }

  // Editorial staleness.
  //
  // An artifact hash answers "is this the same file". It does not answer "is
  // this the same proposal": the same DOCX can be reached from a different
  // baseline or a different set of editorial operations, and the operator
  // approved the proposal as much as the file. Each field is compared only when
  // both sides carry it, so an approval recorded before this existed is not
  // retroactively invalidated by a release that now records editorial state.
  const before = approval.editorial || null;
  const now = release.editorial || null;
  if (before && now) {
    const drifted = [
      ["baselineHash", "the approved baseline changed"],
      ["editorialPlanHash", "the proposed edits changed"],
      ["revisedContentHash", "the accepted wording changed"],
    ].filter(([field]) => before[field] && now[field] && before[field] !== now[field]);
    if (drifted.length) {
      return {
        approved: false,
        reason: `${drifted.map(([, text]) => text).join("; ")} after this was approved; review and approve again`,
      };
    }
  }

  const accepted = new Set(approval.acceptedFindingIds);
  const current = release.findings.map((finding) => finding.id);
  const unacknowledged = current.filter((id) => !accepted.has(id));
  if (unacknowledged.length) {
    return {
      approved: false,
      reason: `findings appeared that were not on screen when this was approved: ${unacknowledged.join(", ")}`,
      unacknowledged,
    };
  }
  return { approved: true, reason: null, unacknowledged: [] };
}

export function resolveReleaseState(applicationDir) {
  const release = readJson(path.join(applicationDir, RELEASE_FILE));
  if (!release) return { state: "draft", release: null, approval: null, reason: "no release record has been written" };
  const approval = readJson(path.join(applicationDir, APPROVAL_FILE));
  const status = approvalStatus(release, approval);
  return {
    state: status.approved ? "operator_approved" : release.state,
    release,
    approval,
    reason: status.reason,
    unacknowledged: status.unacknowledged || [],
  };
}
