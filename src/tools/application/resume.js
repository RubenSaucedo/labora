#!/usr/bin/env node
import fs from "node:fs";
import { resolvePersonaRoot } from "../../lib/workspace.js";
import { selectDefaultResume, verifyDefaultResume } from "../../lib/default-resume.js";

try {
  const args = process.argv.slice(2);
  const persona = args.shift();
  const openingId = args[0] && !args[0].startsWith("--") ? args.shift() : null;
  let descriptor;
  let apply = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--descriptor" && args[0] && !args[0].startsWith("--")) descriptor = args.shift();
    else if (flag === "--apply") apply = true;
    else throw new Error("Unknown or incomplete resume option.");
  }
  if (!persona || (apply && !openingId)) {
    throw new Error("Usage: labora application resume <persona> [opening-id] [--descriptor <current.json>] [--apply]");
  }
  const root = fs.existsSync(persona) ? persona : resolvePersonaRoot(persona);
  const result = openingId ? selectDefaultResume(root, openingId, { descriptor, apply })
    : verifyDefaultResume(root, { descriptor });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
