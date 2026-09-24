#!/usr/bin/env node
// labora workspace migrate — move a persona onto the current layout.
//
// Dry run by default, because this touches a person's own files and the safe
// default for that is to show them what would happen.
//
// Usage:
//   labora workspace migrate <persona>            # show the plan
//   labora workspace migrate <persona> --apply    # do it
import fs from "node:fs";
import path from "node:path";
import { resolvePersonaRoot } from "../../lib/workspace.js";
import { applyMigration, missingProfileFiles, planMigration } from "../../lib/migrate-workspace.js";

const args = process.argv.slice(2);
const personaArg = args.find((arg) => !arg.startsWith("--"));
const apply = args.includes("--apply");

if (!personaArg) {
  process.stderr.write("Usage: labora workspace migrate <persona> [--apply]\n");
  process.exit(1);
}

const personaRoot = fs.existsSync(personaArg) ? personaArg : resolvePersonaRoot(personaArg);
if (!fs.existsSync(personaRoot)) {
  process.stderr.write(`No persona at ${personaRoot}\n`);
  process.exit(1);
}

const plan = planMigration(personaRoot);

if (plan.collisions.length) {
  process.stderr.write(
    `${plan.collisions.length} file(s) already exist at their destination:\n` +
    plan.collisions.map((entry) => `  ${entry.from} -> ${entry.to}`).join("\n") +
    "\nResolve these by hand; nothing has been moved.\n"
  );
  process.exit(2);
}

if (!plan.moves.length && !plan.retired.length) {
  process.stdout.write(`${path.basename(personaRoot)} is already on the current layout.\n`);
  process.exit(0);
}

for (const move of plan.moves) process.stdout.write(`  ${move.from} -> ${move.to}\n`);
for (const entry of plan.retired) {
  process.stdout.write(
    `\n  ${entry.directory}/ (${entry.files} file(s)) is no longer read.\n` +
    `    ${entry.reason}\n` +
    "    Nothing has been deleted. Keep it or remove it; Labora does not look at it.\n"
  );
}

const missing = missingProfileFiles(personaRoot);
if (missing.length) {
  process.stdout.write(
    `\n  profile/ is missing ${missing.join(", ")}.\n` +
    "    Run `/labora:start` to fill these in conversationally.\n"
  );
}

if (!apply) {
  process.stdout.write("\nDry run. Re-run with --apply to move the files above.\n");
  process.exit(0);
}

const applied = applyMigration(personaRoot, plan);
process.stdout.write(`\nMoved ${applied.length} file(s).\n`);
