#!/usr/bin/env node
// validate-evidence-manifest.js — checks evidence/PROVENANCE.json against the
// evidence actually on disk.
//
// Provenance is declared, never inferred from a directory name. This verifies
// the declarations are well-formed, bound to the bytes they describe, and not
// claiming a determination their basis could not have produced.
//
// Usage: labora validate-evidence-manifest <persona> [--output <result.json>]
import fs from "node:fs";
import path from "node:path";

import { resolvePersonaRoot } from "../lib/workspace.js";
import { loadManifest, resolveProvenance, MANIFEST_RELATIVE } from "../lib/evidence-provenance.js";

const personaArg = process.argv[2];
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;

if (!personaArg) {
  process.stderr.write("Usage: labora validate-evidence-manifest <persona> [--output <result.json>]\n");
  process.exit(1);
}

const personaRoot = fs.existsSync(personaArg) ? personaArg : resolvePersonaRoot(personaArg);
const manifest = loadManifest(personaRoot);

const errors = [...manifest.issues];
const warnings = [];

if (!manifest.present) {
  warnings.push({
    code: "manifest_absent",
    message: `No ${MANIFEST_RELATIVE}. Evidence outside the grandfathered paths cannot ground claims until it is declared.`,
  });
}

for (const [relative, entry] of manifest.sources) {
  const absolute = path.join(personaRoot, relative);
  if (!fs.existsSync(absolute)) {
    errors.push({ code: "source_missing", path: relative, message: "Declared in the manifest but not on disk." });
    continue;
  }
  const resolved = resolveProvenance(absolute, personaRoot, manifest);
  if (resolved.state === "stale") {
    errors.push({
      code: "manifest_entry_stale",
      path: relative,
      message: "The file changed after it was classified, so the declaration describes different bytes. Re-hash it, then rebuild the profile.",
    });
  }

  // The real defect behind #10: a bare year segment reads as the year the
  // evidence describes, while it usually records the import batch. Warned, not
  // rejected -- existing claims anchor to these paths and a forced migration
  // would re-anchor every one of them.
  const bareYear = relative.split("/").find((segment) => /^(19|20)\d{2}$/.test(segment));
  if (bareYear) {
    warnings.push({
      code: "ambiguous_year_segment",
      path: relative,
      message: `The path segment "${bareYear}" does not say whether it means when the evidence was written or when it was imported. contentDate=${entry.contentDate}, capturedAt=${entry.capturedAt} are authoritative; consider "captured/${entry.capturedAt}/" for new evidence.`,
    });
  }
}

const result = {
  manifestPresent: manifest.present,
  declaredSources: manifest.sources.size,
  valid: errors.length === 0,
  errors,
  warnings,
};
const payload = JSON.stringify(result, null, 2) + "\n";
if (outputPath) fs.writeFileSync(outputPath, payload);
process.stdout.write(payload);
process.exit(result.valid ? 0 : 1);
