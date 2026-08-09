#!/usr/bin/env node
// validate-observations.js — enforces the exploration output contract.
//
// An observation record grounds claims. A defect report does not. This checks
// that the artifact is the former: every observation carries a measurement and
// an explicit boundary, contradictions are linked, and defects are non-blocking.
//
// Usage: labora validate-observations <observations.json> [--output <result.json>]
import fs from "node:fs";
import { validateObservations } from "../lib/validate-observations.js";

const recordPath = process.argv[2];
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;

if (!recordPath) {
  process.stderr.write("Usage: labora validate-observations <observations.json> [--output <result.json>]\n");
  process.exit(1);
}

try {
  const result = validateObservations(JSON.parse(fs.readFileSync(recordPath, "utf8")));
  const payload = JSON.stringify(result, null, 2) + "\n";
  if (outputPath) fs.writeFileSync(outputPath, payload);
  process.stdout.write(payload);
  process.exit(result.valid ? 0 : 1);
} catch (err) {
  process.stderr.write(`validate-observations error: ${err.message}\n`);
  process.exit(1);
}
