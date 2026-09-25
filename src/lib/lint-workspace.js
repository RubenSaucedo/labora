import fs from "node:fs";
import path from "node:path";

import {
  APPLICATION_IDENTITY_FILES,
  AUTHORED_PROFILE_FILES,
  LEGACY_SOURCES_DIR,
  OWNERSHIP,
  PERSONA_DIRECTORIES,
  RETIRED_GENERATED_DIRS,
  isBareDateSegment,
  isKebabCase,
} from "./workspace-layout.js";

/**
 * Reads a persona tree and reports where it diverges from the declared layout.
 *
 * Every finding here is advisory, and that is not a hedge. A badly named
 * directory does not make a résumé wrong, and refusing to proceed over one
 * would be the drift toward saying no that this plugin exists to resist. The
 * linter makes drift visible and names the route that closes it.
 *
 * It got much shorter when claims were removed. Most of what it used to check
 * existed because claims were anchored to exact paths, so renaming a file
 * silently invalidated the claims citing it, and the linter had to police
 * directory shapes to protect that invariant. Nothing is anchored now. A person
 * can organise their own folder however they like.
 */

function finding(severity, code, message, location, route) {
  return { severity, code, message, location, route };
}

function slugFinding(relative) {
  return finding(
    "info",
    "application_slug_not_kebab_case",
    `applications/${relative}/ is not kebab-case, which makes it harder to type and to sort.`,
    `applications/${relative}/`,
    "Rename it if you like; nothing refers to it by name.",
  );
}

/**
 * A directory is an application when it holds the files that identify one.
 *
 * Checking contents rather than depth is what lets a date directory and an
 * application live at the same level without the linter guessing. A slug that
 * happens to look like a date still reads as an application, because it has a
 * posting in it.
 */
function isApplicationLeaf(dir) {
  return APPLICATION_IDENTITY_FILES.some((file) => fs.existsSync(path.join(dir, file)));
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function lintPersonaLayout(personaRoot) {
  const findings = [];
  const declared = new Map(PERSONA_DIRECTORIES.map((entry) => [entry.name, entry]));

  for (const entry of PERSONA_DIRECTORIES) {
    if (entry.optional) continue;
    if (fs.existsSync(path.join(personaRoot, entry.name))) continue;
    findings.push(finding(
      "warning",
      "missing_required_directory",
      `${entry.name}/ is missing — ${entry.purpose}.`,
      `${entry.name}/`,
      "Run `labora workspace init <persona>` to create it.",
    ));
  }

  for (const entry of listDir(personaRoot)) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (declared.has(entry.name)) continue;

    if (entry.name === LEGACY_SOURCES_DIR) {
      findings.push(finding(
        "info",
        "legacy_sources_directory",
        `${LEGACY_SOURCES_DIR}/ is the old name for sources/. Both hold the same thing: material you already had.`,
        `${LEGACY_SOURCES_DIR}/`,
        "Run `labora workspace migrate <persona> --apply` to move it, or leave it; nothing breaks either way.",
      ));
      continue;
    }

    findings.push(finding(
      "info",
      "undeclared_directory",
      `${entry.name}/ is not a directory any Labora stage reads. That is fine — it is your folder — but nothing will look inside it.`,
      `${entry.name}/`,
      "Keep it, or move its contents under sources/ if you want Labora to read it.",
    ));
  }

  for (const directory of RETIRED_GENERATED_DIRS) {
    if (!fs.existsSync(path.join(personaRoot, directory))) continue;
    findings.push(finding(
      "info",
      "retired_generated_directory",
      `${directory}/ held compiled profile state, which is no longer read. Your profile/ files are the source of truth.`,
      `${directory}/`,
      "Nothing depends on it. Delete it when you are comfortable, or leave it.",
    ));
  }

  const profileDir = path.join(personaRoot, "profile");
  if (fs.existsSync(profileDir)) {
    const present = new Set(
      listDir(profileDir).filter((entry) => entry.isFile()).map((entry) => entry.name)
    );
    for (const file of AUTHORED_PROFILE_FILES) {
      if (present.has(file)) continue;
      findings.push(finding(
        "info",
        "profile_file_absent",
        `profile/${file} has not been written yet.`,
        `profile/${file}`,
        "Run `/labora:start` and talk it through; these files are written from the conversation.",
      ));
    }
  }

  // Applications may sit directly under `applications/`, or be grouped by the
  // date work on them started:
  //
  //   applications/<job-slug>/
  //   applications/<YYYY-MM-DD>/<job-slug>/
  //
  // Both are addressed by explicit path everywhere, so grouping costs nothing
  // functionally. The linter just has to tell a date container apart from an
  // application, or it reports every date directory as a badly named slug.
  const applicationsRoot = path.join(personaRoot, "applications");
  for (const entry of listDir(applicationsRoot)) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(applicationsRoot, entry.name);

    if (isBareDateSegment(entry.name) && !isApplicationLeaf(absolute)) {
      for (const nested of listDir(absolute)) {
        if (!nested.isDirectory() || isKebabCase(nested.name)) continue;
        findings.push(slugFinding(`${entry.name}/${nested.name}`));
      }
      continue;
    }

    if (!isKebabCase(entry.name)) findings.push(slugFinding(entry.name));
  }

  return {
    schemaVersion: "2.0",
    persona: path.basename(personaRoot),
    // Recorded so a reader of the JSON can see what the shapes mean without
    // opening the source.
    layout: {
      directories: PERSONA_DIRECTORIES.map(({ name, ownership, purpose }) => ({ name, ownership, purpose })),
      authoredProfileFiles: [...AUTHORED_PROFILE_FILES],
      ownership: OWNERSHIP,
    },
    findings,
  };
}
