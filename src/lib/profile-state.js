import fs from "node:fs";
import path from "node:path";

/**
 * Where a persona's compiled profile state lives.
 *
 * The three ledgers — `identity.json`, `claims.json`, `accomplishments.json` —
 * are machine state. Nobody authors them, nobody may hand-edit them, and
 * deleting them costs nothing but a rebuild. They have nevertheless been
 * sitting inside `profile/`, the one directory the operator *does* author, as
 * peers of the career history they wrote themselves. A person opening that
 * directory had to already know the pipeline to tell which files were theirs.
 *
 * So new personas keep compiled state at `.labora/state/profile/`, outside the
 * authored tree and outside normal navigation.
 *
 * ## Why this is a resolver and not a move
 *
 * Every existing persona has state at `profile/generated/`. Relocating it on
 * next write would strand any tool still reading the old path, and writing to
 * the new path while the old one still exists would leave two ledgers that
 * disagree — a resume built from a stale copy is exactly the failure the hash
 * checks exist to catch, arriving through the layout instead.
 *
 * The rule is therefore: **state is written wherever it already lives.**
 *
 *   - `.labora/state/profile/` exists  → new layout, use it
 *   - `profile/generated/` exists      → legacy layout, keep using it
 *   - neither exists                   → new persona, use the new layout
 *
 * No persona changes layout by accident, and none changes layout without the
 * operator asking. Moving an existing persona is a migration with a dry run and
 * a reversible manifest; it is not something a read should trigger.
 */

export const STATE_DIR = ".labora/state";
export const NEW_PROFILE_STATE_DIR = ".labora/state/profile";
export const LEGACY_PROFILE_STATE_DIR = "profile/generated";

/** The three compiled ledgers, and nothing else. */
export const PROFILE_STATE_FILES = Object.freeze([
  "identity.json",
  "claims.json",
  "accomplishments.json",
]);

function hasAnyStateFile(dir) {
  if (!fs.existsSync(dir)) return false;
  return PROFILE_STATE_FILES.some((file) => fs.existsSync(path.join(dir, file)));
}

/**
 * Which layout a persona on disk is using.
 *
 * Presence of a *ledger* decides it, not presence of a directory: a scaffolded
 * but empty `profile/generated/` is a placeholder, and treating it as a claim
 * on the layout would pin every new persona to the legacy shape forever.
 *
 * @returns {"state"|"legacy"} — `state` is also the answer for a persona with
 * no compiled state at all, because that is where its first build should land.
 */
export function profileStateLayout(personaRoot) {
  if (hasAnyStateFile(path.join(personaRoot, NEW_PROFILE_STATE_DIR))) return "state";
  if (hasAnyStateFile(path.join(personaRoot, LEGACY_PROFILE_STATE_DIR))) return "legacy";
  if (fs.existsSync(path.join(personaRoot, LEGACY_PROFILE_STATE_DIR))) return "legacy";
  return "state";
}

/** Absolute path to the compiled-state directory this persona actually uses. */
export function profileStateDir(personaRoot) {
  const relative =
    profileStateLayout(personaRoot) === "state" ? NEW_PROFILE_STATE_DIR : LEGACY_PROFILE_STATE_DIR;
  return path.join(personaRoot, ...relative.split("/"));
}

/** Absolute path to one compiled ledger, in whichever layout the persona uses. */
export function profileStatePath(personaRoot, fileName) {
  return path.join(profileStateDir(personaRoot), fileName);
}

/** Both candidate directories, most-preferred first. For diagnostics and linting. */
export function profileStateCandidates(personaRoot) {
  return [
    path.join(personaRoot, ...NEW_PROFILE_STATE_DIR.split("/")),
    path.join(personaRoot, ...LEGACY_PROFILE_STATE_DIR.split("/")),
  ];
}

/**
 * Recovers a persona root from the path of a compiled ledger.
 *
 * Callers hand tools a ledger path rather than a persona name, so the root has
 * to be derived back out of it — and it must land on the same directory under
 * either layout, or a persona would appear to have two identities.
 *
 * Walking up to a directory named `profile` is not enough now: under the new
 * layout that would stop at `.labora/state/profile` and call `.labora/state`
 * the persona. So `.labora` is recognised first and always wins.
 */
export function personaRootFromStateFile(filePath) {
  const resolved = path.resolve(filePath);
  const segments = resolved.split(path.sep);
  const stateIndex = segments.lastIndexOf(".labora");
  if (stateIndex > 0) return segments.slice(0, stateIndex).join(path.sep);

  let dir = path.dirname(resolved);
  for (let hops = 0; hops < 4; hops += 1) {
    if (path.basename(dir) === "profile") return path.dirname(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(path.dirname(resolved));
}
