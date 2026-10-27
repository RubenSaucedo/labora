#!/usr/bin/env node
import fs from "node:fs";
import { resolvePersonaRoot } from "../../lib/workspace.js";
import { readJson } from "../../lib/persona-files.js";
import { trackOpening } from "../../lib/application-workspace.js";

try {
  const [persona, selection, ...flags] = process.argv.slice(2);
  if (!persona || !selection || flags.some((flag) => flag !== "--apply")) {
    throw new Error("Usage: labora application track <persona> <selection.json> [--apply]");
  }
  const root = fs.existsSync(persona) ? persona : resolvePersonaRoot(persona);
  process.stdout.write(`${JSON.stringify(trackOpening(root, readJson(selection), {
    apply: flags.includes("--apply"),
  }), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
