import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ZBaselineResumeContract } from "../schemas/editorial.js";
import { segmentResume } from "./resume-segments.js";

/**
 * The approved baseline.
 *
 * An operator who has already reviewed a resume has made hundreds of decisions
 * the pipeline cannot see: this verb, this order, this much detail, this much
 * restraint. Regenerating from evidence throws all of them away every run, and
 * the operator's only recourse is to re-review the whole document and re-make
 * the same calls. So the baseline is a first-class input.
 *
 * It is also the single most dangerous input in the system, because a document
 * full of confident sentences looks exactly like a source. It is not one. A
 * baseline says *what a person approved saying*; only the claim ledger says
 * what is true. If the baseline could ground a claim, then any sentence that
 * survived one run would be self-supporting from then on, and an unsupported
 * bullet would launder itself into a verified one by being printed once.
 *
 * That is prevented structurally rather than by instruction:
 * `baselineEditorialView()` is the only supported way to read a baseline, and
 * it returns prose spans with no provenance, no claim IDs and no unit IDs.
 * There is nothing in its output to ground anything with.
 */

export const BASELINE_FILE = "baseline.json";

export function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8"))
    .digest("hex");
}

/**
 * The editorial view: prose, order and addresses. Nothing else.
 *
 * `provenance`, `keywords_mapped`, `gaps_or_risks` and `notes_for_human` are
 * dropped rather than passed through. The first would let stale claim IDs
 * travel forward as if re-verified; the rest are working notes from a previous
 * run that should not silently become this run's reasoning.
 */
export function baselineEditorialView(resume) {
  const segments = segmentResume(resume).map(({ location, section, kind, text, hash }) => ({
    location,
    section,
    kind,
    text,
    hash,
  }));
  return {
    schemaVersion: "1.0",
    // Order is itself an operator decision -- which role leads, which bullet is
    // first -- so it is preserved explicitly rather than left implicit in an
    // array someone might re-sort.
    order: segments.map((entry) => entry.location),
    sections: [...new Set(segments.map((entry) => entry.section))],
    segments,
  };
}

const EVIDENCE_BEARING_KEYS = ["provenance", "claimIds", "claim_ids", "unitIds", "claims", "sources"];

/**
 * A test-facing assertion and a runtime guard in one.
 *
 * Returns every path at which an editorial view carries something that could be
 * mistaken for evidence. An empty array is the guarantee.
 */
export function evidenceLeaksInEditorialView(view, trail = "baseline") {
  const leaks = [];
  const walk = (node, at) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${at}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (EVIDENCE_BEARING_KEYS.includes(key)) leaks.push(`${at}.${key}`);
      walk(value, `${at}.${key}`);
    }
  };
  walk(view, trail);
  return leaks;
}

export function baselineContractFor({ filePath, bytes, approval = "unreviewed", approvedAt = "", note = "" }) {
  return ZBaselineResumeContract.parse({
    path: filePath,
    sha256: sha256(bytes),
    approval,
    approvedAt,
    note,
  });
}

/**
 * Whether a recorded contract still describes the file on disk.
 *
 * Every negative reason names what changed. "Your baseline is stale" with no
 * cause is the message that teaches people to re-record reflexively, which is
 * the same as having no contract at all.
 */
export function evaluateBaseline({ contract, bytes }) {
  if (!contract) {
    return { present: false, usable: false, approved: false, actualHash: null, reason: "no baseline was supplied" };
  }
  if (bytes == null) {
    return {
      present: true,
      usable: false,
      approved: false,
      actualHash: null,
      reason: `the baseline named at ${contract.path} could not be read`,
    };
  }
  const actualHash = sha256(bytes);
  if (actualHash !== contract.sha256) {
    return {
      present: true,
      usable: false,
      approved: false,
      actualHash,
      reason:
        "the baseline file changed after it was recorded; its approval no longer applies. " +
        "Re-record the baseline and review what moved.",
    };
  }
  if (contract.approval !== "operator") {
    return {
      present: true,
      // Still usable as a structural reference: order and section shape are
      // informative even unreviewed. It simply does not carry the "a person
      // approved this wording" guarantee.
      usable: true,
      approved: false,
      actualHash,
      reason: "the baseline carries no operator approval, so its wording is a starting point rather than a constraint",
    };
  }
  return { present: true, usable: true, approved: true, actualHash, reason: null };
}

/**
 * Read a baseline named by a strategy's `baselineResume` contract.
 *
 * Resolution is relative to the application directory, because a baseline is
 * part of one application's working state. Absolute paths are honoured for the
 * case where an operator keeps approved resumes outside the application.
 */
export function loadBaseline({ applicationDir, contract, readFile = fs.readFileSync }) {
  if (!contract) {
    return { contract: null, bytes: null, resume: null, view: null, status: evaluateBaseline({ contract: null }) };
  }
  const resolved = path.isAbsolute(contract.path)
    ? contract.path
    : path.resolve(applicationDir, contract.path);

  let bytes = null;
  try {
    bytes = readFile(resolved);
  } catch {
    bytes = null;
  }
  const status = evaluateBaseline({ contract, bytes });
  if (!bytes) return { contract, bytes: null, resume: null, view: null, status, resolvedPath: resolved };

  let resume = null;
  try {
    resume = JSON.parse(bytes.toString("utf8"));
  } catch {
    return {
      contract,
      bytes,
      resume: null,
      view: null,
      resolvedPath: resolved,
      status: { ...status, usable: false, reason: "the baseline is not readable JSON" },
    };
  }
  return {
    contract,
    bytes,
    resume,
    view: baselineEditorialView(resume),
    resolvedPath: resolved,
    status,
  };
}

export function writeBaselineContract(applicationDir, contract) {
  const target = path.join(applicationDir, BASELINE_FILE);
  fs.writeFileSync(target, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  return target;
}

export function readBaselineContract(applicationDir) {
  const target = path.join(applicationDir, BASELINE_FILE);
  if (!fs.existsSync(target)) return null;
  return ZBaselineResumeContract.parse(JSON.parse(fs.readFileSync(target, "utf8")));
}
