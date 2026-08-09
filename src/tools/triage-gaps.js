#!/usr/bin/env node
// triage-gaps.js — classifies unmatched job requirements before any of them is
// called a gap.
//
// "Not in the ledger" is a statement about labora's bookkeeping. "The candidate
// lacks this" is a statement about a person, and the tool is not entitled to
// the second one from the first.
//
// Usage:
//   labora triage-gaps <persona> --requirements <job-spec.json> [--output <triage.json>]
import fs from "node:fs";
import path from "node:path";

import { resolvePersonaRoot } from "../lib/workspace.js";
import { triageRequirement, GAP_STATUS } from "../lib/gap-triage.js";

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const personaArg = process.argv[2];
const requirementsPath = arg("--requirements");
const outputPath = arg("--output");

if (!personaArg || !requirementsPath) {
  process.stderr.write(
    "Usage: labora triage-gaps <persona> --requirements <job-spec.json> [--output <triage.json>]\n"
  );
  process.exit(1);
}

try {
  const personaRoot = fs.existsSync(personaArg) ? personaArg : resolvePersonaRoot(personaArg);
  const generated = path.join(personaRoot, "profile/generated");
  const readIf = (file) =>
    fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;

  const ledger = readIf(path.join(generated, "claims.json")) || { claims: [] };
  const identity = readIf(path.join(generated, "identity.json")) || {};
  const spec = JSON.parse(fs.readFileSync(requirementsPath, "utf8"));

  const requirements = spec.requirements || spec.unmatched || [];
  const results = requirements.map((requirement) =>
    triageRequirement(requirement, { personaRoot, ledger, identity })
  );

  const counts = Object.fromEntries(
    Object.values(GAP_STATUS).map((status) => [
      status,
      results.filter((r) => r.status === status).length,
    ])
  );

  const payload = {
    persona: path.basename(personaRoot),
    triaged: results.length,
    counts,
    // Only a real gap or an unconfirmed adjacency is worth a human's attention.
    // Asking a person is the slowest path available and produces self-report
    // rather than evidence, so it is the last resort, never the first move.
    needsHuman: results.filter((r) => r.escalateToHuman).length,
    requirements: results,
  };
  const json = JSON.stringify(payload, null, 2) + "\n";
  if (outputPath) fs.writeFileSync(outputPath, json);
  process.stdout.write(json);
} catch (err) {
  process.stderr.write(`triage-gaps error: ${err.message}\n`);
  process.exit(1);
}
