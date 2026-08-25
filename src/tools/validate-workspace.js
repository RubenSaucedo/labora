#!/usr/bin/env node
// validate-workspace.js — reports where a persona tree diverges from the
// declared layout contract in src/lib/workspace-layout.js.
//
// Advisory by design. A misnamed directory is a navigation problem, never an
// assurance one, so this exits 0 with findings and only fails under --strict,
// which exists for repository CI rather than for an operator building a resume.
//
// Usage: labora validate-workspace <persona> [--strict] [--output <result.json>]
import fs from "node:fs";

import { lintPersonaLayout } from "../lib/lint-workspace.js";
import { resolvePersonaRoot } from "../lib/workspace.js";

const args = process.argv.slice(2);
const personaArg = args.find((arg) => !arg.startsWith("--"));
const strict = args.includes("--strict");
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;

if (!personaArg) {
  process.stderr.write("Usage: labora validate-workspace <persona> [--strict] [--output <result.json>]\n");
  process.exit(1);
}

const personaRoot = fs.existsSync(personaArg) ? personaArg : resolvePersonaRoot(personaArg);
if (!fs.existsSync(personaRoot)) {
  process.stderr.write(`No persona at ${personaRoot}\n`);
  process.exit(1);
}

const result = lintPersonaLayout(personaRoot);
const payload = JSON.stringify(result, null, 2) + "\n";
if (outputPath) fs.writeFileSync(outputPath, payload);
process.stdout.write(payload);

if (result.findings.length) {
  const lines = result.findings.map(
    (f) => `  [${f.severity}] ${f.location} — ${f.message}\n           → ${f.route}`
  );
  process.stderr.write(
    `\nWORKSPACE LAYOUT: ${result.warningCount} warning(s), ${result.infoCount} note(s)\n` +
      `${lines.join("\n")}\n\n` +
      "None of this blocks a build. It is reported so the tree stays navigable.\n"
  );
}

process.exit(strict && result.warningCount > 0 ? 1 : 0);
