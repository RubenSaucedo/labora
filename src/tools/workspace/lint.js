#!/usr/bin/env node
// labora workspace lint — report where a persona tree diverges from the layout.
//
// Advisory by design. A misnamed directory is a navigation problem, never a
// reason to stop someone building a résumé, so this exits 0 with findings and
// only fails under --strict, which exists for this repository's CI rather than
// for a person using the plugin.
//
// Usage: labora workspace lint <persona> [--strict] [--output <result.json>]
import fs from "node:fs";

import { lintPersonaLayout } from "../../lib/lint-workspace.js";
import { resolvePersonaRoot } from "../../lib/workspace.js";

const args = process.argv.slice(2);
const personaArg = args.find((arg) => !arg.startsWith("--"));
const strict = args.includes("--strict");
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;

if (!personaArg) {
  process.stderr.write("Usage: labora workspace lint <persona> [--strict] [--output <result.json>]\n");
  process.exit(1);
}

const personaRoot = fs.existsSync(personaArg) ? personaArg : resolvePersonaRoot(personaArg);
if (!fs.existsSync(personaRoot)) {
  process.stderr.write(`No persona at ${personaRoot}\n`);
  process.exit(1);
}

const result = lintPersonaLayout(personaRoot);
const payload = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, payload);
process.stdout.write(payload);

if (result.findings.length && strict) process.exitCode = 2;
