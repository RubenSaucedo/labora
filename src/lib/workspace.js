import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Persona data is PERSONAL — career history, performance reviews, compensation,
// past resumes. It must be able to live outside this repository entirely, in a
// private workspace the operator controls, so that labora itself never stores
// user data and can be installed as a plugin without carrying anyone's history.
//
// A workspace is just a directory holding `personas/<name>/`. Git is a
// recommendation on top of that, never a requirement: mandating a repo would
// add an accidental-public-remote failure mode that is worse than the problem.
//
// Resolution order (first match wins for reads; the first entry is where new
// personas are written):
//   1. $LABORA_WORKSPACE                       explicit, wins over everything
//   2. `workspace` in the nearest labora.json  pointer, e.g. "../labora-ruben"
//   3. <cwd>                                   the cwd IS the workspace
//   4. <cwd>/data                              legacy in-repo layout
//   5. <pluginRoot>/data                       bundled fixtures (the `example` persona)
//
// Entry 3 is what lets labora work as an installed plugin: you run it from your
// own workspace directory, and `personas/` there is found with no configuration
// at all. Entry 5 keeps the committed `example` persona resolvable regardless,
// so the suite and the docs work wherever the plugin lives.

const WORKSPACE_MARKER = "labora.json";
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// A workspace root may hold `personas/` directly (the private-workspace layout)
// or `data/personas/` (the legacy in-repo layout). Accept either so a migration
// does not have to be atomic.
function personasDirFor(root) {
  if (!root) return null;
  const direct = path.join(root, "personas");
  if (isDir(direct)) return direct;
  const nested = path.join(root, "data", "personas");
  if (isDir(nested)) return nested;
  return direct;
}

function findMarkerFile(startDir) {
  let dir = path.resolve(startDir);
  for (let hops = 0; hops < 6; hops += 1) {
    const candidate = path.join(dir, WORKSPACE_MARKER);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function workspaceFromMarker(cwd) {
  const marker = findMarkerFile(cwd);
  if (!marker) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(marker, "utf-8"));
  } catch (err) {
    throw new Error(`${marker} is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed.workspace !== "string" || !parsed.workspace.trim()) return null;
  // Relative pointers resolve against the marker, not the cwd, so the same
  // checked-in file works from any subdirectory.
  return path.resolve(path.dirname(marker), parsed.workspace.trim());
}

/**
 * Ordered persona-container directories. Reads walk these in order; writes use
 * the first. Always returns at least one entry.
 */
export function personaSearchPaths({ cwd = process.cwd(), env = process.env } = {}) {
  const roots = [];
  const push = (root) => {
    const dir = personasDirFor(root);
    if (dir && !roots.includes(dir)) roots.push(dir);
  };

  const explicit = (env.LABORA_WORKSPACE || "").trim();
  if (explicit) push(path.resolve(explicit));

  try {
    push(workspaceFromMarker(cwd));
  } catch (err) {
    // A malformed marker is an operator error worth surfacing, not swallowing.
    throw err;
  }

  // The cwd itself is a workspace when it holds `personas/`. This is the
  // zero-config path for an installed plugin: cd into your workspace and run.
  // Guarded on existence so an unrelated cwd does not become the write target
  // and silently scaffold a persona somewhere arbitrary.
  if (isDir(path.join(cwd, "personas"))) push(cwd);

  push(path.join(cwd, "data"));
  push(path.join(PLUGIN_ROOT, "data"));

  return roots;
}

/** Where a *new* persona is created. */
export function primaryPersonasDir(opts = {}) {
  return personaSearchPaths(opts)[0];
}

/**
 * Resolve an existing persona to its root directory. Falls back to the primary
 * workspace path when the persona does not exist yet, so callers that create
 * personas get the right destination.
 */
export function resolvePersonaRoot(name, opts = {}) {
  const clean = (name || "").trim();
  if (!clean) throw new Error("persona name is required");
  const roots = personaSearchPaths(opts);
  for (const root of roots) {
    const candidate = path.join(root, clean);
    if (isDir(candidate)) return candidate;
  }
  return path.join(roots[0], clean);
}

/** True when persona data lives outside this repository. */
export function isExternalWorkspace(opts = {}) {
  const primary = primaryPersonasDir(opts);
  return !primary.startsWith(path.join(PLUGIN_ROOT, path.sep));
}

export { PLUGIN_ROOT, WORKSPACE_MARKER };
