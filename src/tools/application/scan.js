#!/usr/bin/env node
import fs from "node:fs";
import { resolvePersonaRoot } from "../../lib/workspace.js";
import { preparationOpening, saveCapturedForm } from "../../lib/application-preparation.js";
import { observeApplication } from "../../lib/application-browser.js";

try {
  const [persona, openingId, url, ...flags] = process.argv.slice(2);
  if (!persona || !openingId || !url || flags.some((flag) => flag !== "--apply")) {
    throw new Error("Usage: labora application scan <persona> <opening-id> <explicit-form-url> [--apply]");
  }
  const root = fs.existsSync(persona) ? persona : resolvePersonaRoot(persona);
  preparationOpening(root, openingId);
  const observed = await observeApplication(url);
  try {
    process.stdout.write(`${JSON.stringify(saveCapturedForm(root, openingId, observed.form, {
      apply: flags.includes("--apply"),
    }), null, 2)}\n`);
  } finally {
    await observed.close();
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
