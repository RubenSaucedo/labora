#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ZReleaseApproval } from "../schemas/release-output.js";
import { APPROVAL_FILE, RELEASE_FILE, resolveReleaseState } from "../lib/release-state.js";

/**
 * The operator's decision, recorded.
 *
 * Labora never writes this on anyone's behalf, and it never infers it from a
 * clean run. A resume with nothing to report still requires the person whose
 * career it describes to say "send this one".
 *
 * `--accept-all` is not a way around reading. It records that the operator saw
 * this exact finding set against this exact file; change either and the
 * approval stops applying, visibly.
 */

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function main() {
  const applicationArg = process.argv[2];
  if (!applicationArg || applicationArg.startsWith("--")) {
    process.stderr.write(
      "Usage: labora approve <application-dir> --accept-all [--note <text>]\n" +
      "       labora approve <application-dir> --accept <finding-id>[,<finding-id>...]\n" +
      "       labora approve <application-dir> --status\n" +
      "       labora approve <application-dir> --revoke\n"
    );
    process.exit(1);
  }
  const applicationDir = path.resolve(applicationArg);
  const releasePath = path.join(applicationDir, RELEASE_FILE);
  if (!fs.existsSync(releasePath)) {
    process.stderr.write(`no ${RELEASE_FILE} in ${applicationArg}. Run \`labora quality-gate\` first.\n`);
    process.exit(1);
  }
  const approvalPath = path.join(applicationDir, APPROVAL_FILE);

  if (hasFlag("--revoke")) {
    if (fs.existsSync(approvalPath)) fs.rmSync(approvalPath);
    process.stdout.write("approval revoked.\n");
    return;
  }

  const resolved = resolveReleaseState(applicationDir);

  if (hasFlag("--status")) {
    process.stdout.write(`state: ${resolved.state}\n`);
    if (resolved.reason) process.stdout.write(`why:   ${resolved.reason}\n`);
    return;
  }

  const release = resolved.release;
  if (release.state === "generation_failed") {
    // Not a policy refusal. There is genuinely no document to approve.
    process.stderr.write("nothing to approve: the requested artifact was not produced.\n");
    process.exit(2);
  }

  const currentIds = release.findings.map((finding) => finding.id);
  let accepted;
  if (hasFlag("--accept-all")) {
    accepted = currentIds;
  } else {
    const raw = flag("--accept");
    if (!raw) {
      process.stderr.write("specify --accept-all or --accept <finding-id>[,...]\n");
      process.exit(1);
    }
    accepted = raw.split(",").map((id) => id.trim()).filter(Boolean);
    const unknown = accepted.filter((id) => !currentIds.includes(id));
    if (unknown.length) {
      process.stderr.write(`unknown finding id(s): ${unknown.join(", ")}\n`);
      process.exit(1);
    }
    const missing = currentIds.filter((id) => !accepted.includes(id));
    if (missing.length) {
      // Refusing here is not a veto over the resume -- the operator may send
      // whatever they like. It refuses to *record* an approval that would look
      // complete while some findings were never acknowledged.
      process.stderr.write(
        `not recording an approval: ${missing.length} finding(s) unacknowledged: ${missing.join(", ")}\n` +
        "accept them explicitly, or use --accept-all.\n"
      );
      process.exit(1);
    }
  }

  const approval = ZReleaseApproval.parse({
    schemaVersion: "1.0",
    artifactHash: release.artifact.hash,
    decision: "approved_by_operator",
    acceptedFindingIds: accepted,
    decidedAt: new Date().toISOString(),
    note: flag("--note"),
  });
  fs.writeFileSync(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
  process.stdout.write(
    `approved ${release.artifact.path} (${accepted.length} finding(s) acknowledged)\n` +
    "state: operator_approved\n"
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`approve error: ${error.message}\n`);
    process.exit(1);
  }
}
