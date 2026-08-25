import fs from "node:fs";
import path from "node:path";

import {
  AUTHORED_PROFILE_FILES,
  EVIDENCE_SHAPES,
  GENERATED_PROFILE_DIR,
  PROFILE_STATE_DIR,
  OWNERSHIP,
  PERSONA_DIRECTORIES,
  isBareDateSegment,
  isBareYearSegment,
  isDatedSubjectSegment,
  isKebabCase,
} from "./workspace-layout.js";

/**
 * Reads a persona tree and reports where it diverges from the declared layout.
 *
 * Every finding here is **advisory**. Nothing this module observes is a fact
 * about whether a document is honest: a badly named directory does not make a
 * claim false, and refusing to proceed over one would be exactly the drift
 * toward saying no that the product exists to resist. The linter's job is to
 * make drift visible and name the route that closes it, then get out of the
 * way.
 *
 * Severities are therefore navigation severities, not assurance severities:
 *
 *   - `warning` — ambiguous to a human reading the tree, and fixable now.
 *   - `info`    — a recognised legacy shape, or a known migration target. It
 *                 is reported so the operator is not surprised later, never to
 *                 suggest they did something wrong.
 */

function finding(severity, code, message, location, route) {
  return { severity, code, message, location, route };
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function relative(personaRoot, absolute) {
  return path.relative(personaRoot, absolute).split(path.sep).join("/");
}

/**
 * Walks `evidence/<type>/...` and classifies each item directory.
 *
 * Only the first level under a source type is classified. Deeper nesting
 * belongs to whichever shape that level declared, and re-deciding it per level
 * would report the same directory several times in different voices.
 */
function lintEvidence(personaRoot, findings) {
  const evidenceRoot = path.join(personaRoot, "evidence");
  if (!fs.existsSync(evidenceRoot)) return;

  const stageNames = new Set(["raw", "extracted", "text", "validations"]);

  for (const type of listDir(evidenceRoot)) {
    if (!type.isDirectory()) continue;
    const typeDir = path.join(evidenceRoot, type.name);

    if (!isKebabCase(type.name)) {
      findings.push(finding(
        "warning",
        "non_kebab_segment",
        `Evidence source type "${type.name}" is not lowercase kebab-case, so it sorts and reads inconsistently beside the others.`,
        relative(personaRoot, typeDir),
        "Rename it with `labora migrate-workspace` once available; renaming by hand re-anchors every claim citing it."
      ));
    }

    const children = listDir(typeDir).filter((entry) => entry.isDirectory());
    const usesStageDirs = children.some((entry) => stageNames.has(entry.name));

    if (usesStageDirs) {
      findings.push(finding(
        "info",
        "processing_stage_layout",
        `"${type.name}" is organised by pipeline stage (${children.filter((c) => stageNames.has(c.name)).map((c) => c.name).sort().join(", ")}), so one evidence item is spread across several directories.`,
        relative(personaRoot, typeDir),
        "Recognised and supported. New evidence reads better as one directory per item; see the preferred shape in resume-conventions."
      ));
      continue;
    }

    for (const item of children) {
      const itemDir = path.join(typeDir, item.name);
      const location = relative(personaRoot, itemDir);

      if (isBareYearSegment(item.name)) {
        findings.push(finding(
          "warning",
          "bare_year_segment",
          `"${item.name}" does not say whether it means the year the evidence describes or the year it was imported. In practice such directories collect material from several years.`,
          location,
          "Name it for what the evidence describes plus a subject, e.g. `2025-03-annual-review`. The manifest's contentDate and capturedAt stay authoritative either way."
        ));
        continue;
      }

      if (isBareDateSegment(item.name)) {
        findings.push(finding(
          "warning",
          "date_without_subject",
          `"${item.name}" is a date with no subject, so the directory cannot be identified without opening it.`,
          location,
          `Append a stable subject slug, e.g. \`${item.name}-<subject>\`.`
        ));
        continue;
      }

      if (!isDatedSubjectSegment(item.name) && !isKebabCase(item.name)) {
        findings.push(finding(
          "warning",
          "non_kebab_segment",
          `"${item.name}" is not lowercase kebab-case.`,
          location,
          "Use `<date>-<subject>` in lowercase ASCII kebab-case."
        ));
      }
    }
  }
}

function lintProfile(personaRoot, findings) {
  const profileDir = path.join(personaRoot, "profile");
  if (!fs.existsSync(profileDir)) {
    findings.push(finding(
      "warning",
      "profile_missing",
      "This persona has no profile/ directory, so there is nothing for a human to author or for the builder to compile.",
      "profile",
      "Create profile/background.md and profile/contact.md, then run profile-builder."
    ));
    return;
  }

  const authored = new Set(AUTHORED_PROFILE_FILES);
  for (const entry of listDir(profileDir)) {
    if (entry.isDirectory()) continue;
    if (authored.has(entry.name)) continue;
    findings.push(finding(
      "info",
      "undeclared_profile_file",
      `"${entry.name}" sits beside the authored profile sources but is not one of them, so a reader cannot tell whether it is safe to edit.`,
      `profile/${entry.name}`,
      `Authored profile files are: ${AUTHORED_PROFILE_FILES.join(", ")}. Anything else belongs in evidence/ or in generated state.`
    ));
  }

  // The complaint this contract exists to answer: are compiled ledgers sitting
  // among the files the operator authors? Reported only when they actually are.
  const legacyState = path.join(personaRoot, GENERATED_PROFILE_DIR);
  const strandedLedgers = listDir(legacyState)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);
  if (strandedLedgers.length) {
    findings.push(finding(
      "info",
      "generated_state_in_authored_tree",
      `Compiled ledgers (${strandedLedgers.sort().join(", ")}) sit inside profile/, the directory the operator authors, so machine state and authored career history are presented as peers.`,
      GENERATED_PROFILE_DIR,
  PROFILE_STATE_DIR,
      `Recognised and supported; nothing is wrong with this persona. New personas keep them at ${PROFILE_STATE_DIR}, and a migrator will move an existing one on request. Until then, never hand-edit them to make a validation pass.`
    ));
  }
}

function lintTopLevel(personaRoot, findings) {
  const declared = new Map(PERSONA_DIRECTORIES.map((entry) => [entry.name, entry]));
  for (const entry of listDir(personaRoot)) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (declared.has(entry.name)) continue;
    findings.push(finding(
      "info",
      "undeclared_directory",
      `"${entry.name}" is not part of the declared persona layout, so no stage reads it and its contents cannot ground a claim.`,
      entry.name,
      `Declared directories are: ${PERSONA_DIRECTORIES.map((d) => d.name).join(", ")}.`
    ));
  }
}

/**
 * @returns {{ persona: string, findings: Array, warningCount: number, infoCount: number, preferredEvidenceShape: string }}
 */
export function lintPersonaLayout(personaRoot) {
  const findings = [];
  lintTopLevel(personaRoot, findings);
  lintProfile(personaRoot, findings);
  lintEvidence(personaRoot, findings);

  findings.sort((a, b) =>
    `${a.location}|${a.code}`.localeCompare(`${b.location}|${b.code}`));

  return {
    persona: path.basename(personaRoot),
    findings,
    warningCount: findings.filter((f) => f.severity === "warning").length,
    infoCount: findings.filter((f) => f.severity === "info").length,
    preferredEvidenceShape: EVIDENCE_SHAPES.find((shape) => shape.preferred).example,
    ownership: PERSONA_DIRECTORIES.map(({ name, ownership }) => ({ path: name, ownership })),
    profileStateDir: PROFILE_STATE_DIR,
    reviewSurfaceDir: GENERATED_PROFILE_DIR,
    ownershipVocabulary: OWNERSHIP,
  };
}
