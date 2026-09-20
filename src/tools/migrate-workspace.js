#!/usr/bin/env node
// migrate-workspace.js — moves a persona to the current workspace layout.
//
// Dry run by default. `--apply` executes and writes a reversible manifest;
// `--revert <manifest>` undoes an applied migration exactly.
//
// Usage:
//   labora migrate-workspace <persona> [--name <path>=<new-name>]...
//   labora migrate-workspace <persona> --apply
//   labora migrate-workspace <persona> --revert <manifest.json>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

import { resolvePersonaRoot } from "../lib/workspace.js";
import { planWorkspaceMigration, migrationManifest } from "../lib/migrate-workspace.js";

const MIGRATIONS_DIR = [".labora", "state", "migrations"];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function abs(personaRoot, relative) {
  return path.join(personaRoot, ...relative.split("/"));
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

function rewriteJson(file, rewrite) {
  const body = JSON.parse(fs.readFileSync(file, "utf8"));
  rewrite(body);
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

/**
 * Repoints every recorded reference in one pass per file.
 *
 * **Always run against the pre-move tree.** The recorded `file` is where a
 * ledger lives before migrating, and the ledger is itself one of the things
 * that moves — so rewriting after the move would look for it at a path that no
 * longer exists. Apply reanchors first, then move; revert moves first, then
 * reverses the reanchors. Both orders leave this function reading the same
 * layout.
 *
 * Both directions use this, because a revert is not a special case: it is the
 * same rewrite with `from` and `to` exchanged.
 */
function applyReanchors(personaRoot, reanchors, { reverse = false } = {}) {
  const byFile = new Map();
  for (const entry of reanchors) {
    if (!byFile.has(entry.file)) byFile.set(entry.file, []);
    byFile.get(entry.file).push(entry);
  }

  for (const [relative, entries] of byFile) {
    const file = abs(personaRoot, relative);
    // Never skip silently. A reference that cannot be repointed is a stranded
    // claim, and a migration that reports success while stranding one is the
    // worst outcome this tool can produce.
    if (!fs.existsSync(file)) {
      throw new Error(`cannot repoint references: ${relative} is not where the plan expects it`);
    }
    const mapping = new Map(
      entries.map((e) => (reverse ? [e.to, e.from] : [e.from, e.to]))
    );
    rewriteJson(file, (body) => {
      for (const claim of body.claims || []) {
        for (const source of [...(claim.sources || []), ...(claim.externalSources || [])]) {
          const next = mapping.get(source.path);
          if (next) source.path = next;
        }
      }
      for (const entry of body.sources || []) {
        const next = mapping.get(entry.path);
        if (next) entry.path = next;
      }
    });
  }
}

function pruneEmptyDirs(personaRoot, movedFrom) {
  const dirs = new Set();
  for (const relative of movedFrom) {
    let dir = path.dirname(abs(personaRoot, relative));
    while (dir.startsWith(personaRoot) && dir !== personaRoot) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  // Deepest first, so a parent is only considered after its children are gone.
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* a directory that is not empty, or already gone, is not a failure */
    }
  }
}

function report(plan) {
  const lines = [`persona: ${plan.persona}`];
  lines.push(`${plan.moves.length} file(s) to move, ${plan.reanchors.length} reference(s) to repoint`);

  for (const move of plan.moves.slice(0, 20)) lines.push(`  ${move.from}\n    -> ${move.to}`);
  if (plan.moves.length > 20) lines.push(`  ... and ${plan.moves.length - 20} more`);

  for (const q of plan.questions) {
    lines.push(`\n  [needs a name] ${q.path}\n    ${q.reason}\n    supply: ${q.supplyWith}`);
  }
  for (const p of plan.problems) {
    lines.push(`\n  [problem] ${p.path || p.to || p.file}: ${p.reason}`);
  }
  return lines.join("\n");
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const revertIndex = args.indexOf("--revert");
  const personaArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--name" && args[i - 1] !== "--revert");

  if (!personaArg) {
    console.error("usage: labora migrate-workspace <persona> [--name <path>=<new-name>] [--apply|--revert <manifest>]");
    process.exit(1);
  }

  const personaRoot = fs.existsSync(personaArg) ? path.resolve(personaArg) : resolvePersonaRoot(personaArg);
  if (!fs.existsSync(personaRoot)) {
    console.error(`no persona at ${personaRoot}`);
    process.exit(1);
  }

  if (revertIndex >= 0) {
    const manifestPath = args[revertIndex + 1];
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      console.error("--revert needs the path of a migration manifest written by --apply");
      process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    // Verify before undoing anything. A revert that runs against a tree someone
    // has since edited would restore a mixture of two states, which is worse
    // than either.
    const missing = manifest.moves.filter((m) => !fs.existsSync(abs(personaRoot, m.to)));
    if (missing.length) {
      console.error(`refusing to revert: ${missing.length} migrated file(s) are no longer where the manifest left them.`);
      for (const m of missing.slice(0, 5)) console.error(`  missing ${m.to}`);
      process.exit(1);
    }
    const changed = manifest.moves.filter((m) => m.hash && sha256(abs(personaRoot, m.to)) !== m.hash);
    if (changed.length) {
      console.error(`refusing to revert: ${changed.length} migrated file(s) changed after the migration.`);
      for (const m of changed.slice(0, 5)) console.error(`  changed ${m.to}`);
      process.exit(1);
    }

    // Move first, then reverse the rewrites: reanchors are recorded against the
    // pre-migration tree, so the ledger has to be back at its original path
    // before it can be rewritten.
    for (const move of manifest.moves) moveFile(abs(personaRoot, move.to), abs(personaRoot, move.from));
    pruneEmptyDirs(personaRoot, manifest.moves.map((m) => m.to));
    applyReanchors(personaRoot, manifest.reanchors || [], { reverse: true });    console.log(`reverted ${manifest.moves.length} file(s) and ${(manifest.reanchors || []).length} reference(s)`);
    process.exit(0);
  }

  const names = new Map();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--name") continue;
    const [key, value] = (args[i + 1] || "").split("=");
    if (key && value) names.set(key, value);
  }

  const plan = planWorkspaceMigration(personaRoot, names);
  console.log(report(plan));

  if (!plan.moves.length) {
    console.log("\nnothing to migrate: this persona already uses the current layout.");
    process.exit(0);
  }
  if (!plan.applicable) {
    // A dry run that reports open questions has done its job, so it succeeds.
    // Only a request to *act* on an unresolved plan is refused — reporting a
    // gap and exiting non-zero would make asking for the plan feel like a
    // failure, which is precisely the reflex this tool is meant to avoid.
    if (!apply) {
      console.log("\nnothing can be applied yet: answer the questions above, then re-run.");
      process.exit(0);
    }
    console.error("\nrefusing to apply: resolve every question and problem above first.");
    process.exit(1);
  }
  if (!apply) {
    console.log("\ndry run. re-run with --apply to execute.");
    process.exit(0);
  }

  const manifest = migrationManifest(plan);
  const manifestDir = path.join(personaRoot, ...MIGRATIONS_DIR);
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${manifest.createdAt.replace(/[:.]/g, "-")}.json`);

  // The manifest is written before the first move. A crash mid-migration must
  // leave a record of what was intended, or the tree is unrecoverable by
  // anything but hand.
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // Rewrite references before anything moves. The ledger being repointed is
  // itself one of the files that moves, so the reverse order would look for it
  // where it no longer is.
  applyReanchors(personaRoot, plan.reanchors);
  for (const move of plan.moves) moveFile(abs(personaRoot, move.from), abs(personaRoot, move.to));
  pruneEmptyDirs(personaRoot, plan.moves.map((m) => m.from));

  // Re-record each hash from what actually landed. Repointing a ledger changes
  // its bytes, so the pre-flight hash describes the file before the migration,
  // not after it. Revert's guard asks "did anything change *since* the
  // migration finished", and it can only ask that against the settled tree.
  manifest.moves = manifest.moves.map((move) => ({
    ...move,
    hash: sha256(abs(personaRoot, move.to)),
  }));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`\nmoved ${plan.moves.length} file(s), repointed ${plan.reanchors.length} reference(s)`);
  console.log(`reversible with: labora migrate-workspace ${plan.persona} --revert ${manifestPath}`);
}
