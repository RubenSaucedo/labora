#!/usr/bin/env node
import fs from "node:fs";
import { resolvePersonaRoot } from "../../lib/workspace.js";
import { prepareApplication } from "../../lib/application-preparation.js";

try {
  const [persona, openingId, bank, ...flags] = process.argv.slice(2);
  if (!persona || !openingId || !bank || flags.some((flag) => flag !== "--apply")) {
    throw new Error("Usage: labora application plan <persona> <opening-id> <persona-relative-answer-bank.json> [--apply]");
  }
  const root = fs.existsSync(persona) ? persona : resolvePersonaRoot(persona);
  process.stdout.write(`${JSON.stringify(prepareApplication(root, openingId, bank, {
    apply: flags.includes("--apply"),
  }), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
