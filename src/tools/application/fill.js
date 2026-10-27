#!/usr/bin/env node
import fs from "node:fs";
import { resolvePersonaRoot } from "../../lib/workspace.js";
import { enterApplication } from "../../lib/application-entry.js";

try {
  const [persona, openingId, liveFlag, requestedOpeningId, ...extra] = process.argv.slice(2);
  if (!persona || !openingId || liveFlag !== "--live" || requestedOpeningId !== openingId || extra.length) {
    throw new Error("Usage: labora application fill <persona> <opening-id> --live <same-opening-id>");
  }
  const root = fs.existsSync(persona) ? persona : resolvePersonaRoot(persona);
  const { close, waitForClose, ...result } = await enterApplication(root, openingId, { requestedOpeningId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await waitForClose();
  if (result.errors.length) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
