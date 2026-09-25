import fs from "node:fs";
import path from "node:path";
import {
  AUTHORED_PROFILE_FILES,
  LEGACY_SOURCES_DIR,
  RETIRED_GENERATED_DIRS,
} from "./workspace-layout.js";

/**
 * Moving a persona onto the current layout.
 *
 * Two things changed when the claim ledger was removed. `evidence/` became
 * `sources/`, because the old name described what the folder was *for* under a
 * model where material had to prove something; it is now simply the stuff the
 * person already had. And `profile/generated/` stopped being read at all.
 *
 * Nothing is deleted. A person's files are theirs, and a migration that throws
 * away a directory because the tool no longer reads it is exactly the kind of
 * decision this refactor exists to stop making on their behalf. Retired
 * directories are reported so they can decide.
 */

function listFiles(root) {
  const found = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next, nextRel);
      else found.push(nextRel);
    }
  };
  if (fs.existsSync(root)) walk(root, "");
  return found.sort();
}

/**
 * What a migration would do, without doing it.
 *
 * `moves` are files that change path. `retired` are directories nothing reads
 * any more. `collisions` are moves whose destination already exists, which is
 * the one case that needs a person rather than a default.
 */
export function planMigration(personaRoot) {
  const moves = [];
  const collisions = [];
  const retired = [];

  const legacySources = path.join(personaRoot, LEGACY_SOURCES_DIR);
  if (fs.existsSync(legacySources)) {
    for (const relative of listFiles(legacySources)) {
      const to = `sources/${relative}`;
      const entry = { from: `${LEGACY_SOURCES_DIR}/${relative}`, to };
      if (fs.existsSync(path.join(personaRoot, to))) collisions.push(entry);
      else moves.push(entry);
    }
  }

  for (const directory of RETIRED_GENERATED_DIRS) {
    const absolute = path.join(personaRoot, directory);
    if (!fs.existsSync(absolute)) continue;
    retired.push({
      directory,
      files: listFiles(absolute).length,
      reason:
        "compiled profile state is no longer read; your own profile/ files are the source of truth now",
    });
  }

  return { moves, collisions, retired };
}

export function applyMigration(personaRoot, plan) {
  const applied = [];
  for (const move of plan.moves) {
    const from = path.join(personaRoot, move.from);
    const to = path.join(personaRoot, move.to);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    applied.push(move);
  }
  // Prune the directories the moves emptied, deepest first, and only when they
  // are genuinely empty.
  const legacy = path.join(personaRoot, LEGACY_SOURCES_DIR);
  const prune = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) prune(path.join(dir, entry.name));
    }
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  };
  prune(legacy);
  return applied;
}

/** The authored files a persona is expected to have. Absence is reported, never fixed. */
export function missingProfileFiles(personaRoot) {
  return AUTHORED_PROFILE_FILES.filter(
    (file) => !fs.existsSync(path.join(personaRoot, "profile", file))
  );
}
