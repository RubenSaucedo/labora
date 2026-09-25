#!/usr/bin/env node
// labora workspace init — create the folder a persona lives in.
//
// Deliberately tiny. Creating directories is the only part of onboarding that
// is genuinely mechanical; everything that matters — what this person has done,
// what they want next, what they already have written down — is a conversation,
// and lives in the `start` skill.
//
// It never overwrites. Re-running it on an existing persona is safe and is the
// normal way to repair a folder somebody moved things out of.
//
// Usage: labora workspace init <persona> [--workspace <dir>]
import fs from "node:fs";
import path from "node:path";
import { PERSONA_DIRECTORIES } from "../../lib/workspace-layout.js";
import { primaryPersonasDir } from "../../lib/workspace.js";

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const persona = process.argv[2];
if (!persona || persona.startsWith("--")) {
  process.stderr.write("Usage: labora workspace init <persona> [--workspace <dir>]\n");
  process.exit(1);
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(persona)) {
  process.stderr.write(
    `"${persona}" is not a valid persona name. Use lowercase letters, numbers and hyphens.\n`
  );
  process.exit(1);
}

try {
  const personasDir = flag("--workspace")
    ? path.join(flag("--workspace"), "personas")
    : primaryPersonasDir();
  const personaRoot = path.join(personasDir, persona);

  const created = [];
  for (const directory of PERSONA_DIRECTORIES) {
    const target = path.join(personaRoot, directory.name);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(target, { recursive: true });
    created.push(`${directory.name}/`);
  }

  process.stdout.write(`${personaRoot}\n`);
  if (created.length) {
    for (const entry of created) process.stdout.write(`  created ${entry}\n`);
  } else {
    process.stdout.write("  already set up; nothing to create\n");
  }
  process.stdout.write(
    "\nNothing has been written to profile/ — that is the person's own account of\n" +
    "their career, and it gets filled in by talking, not by a template.\n"
  );
} catch (error) {
  process.stderr.write(`workspace init error: ${error.message}\n`);
  process.exit(1);
}
