import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  LEGACY_PROFILE_STATE_DIR,
  NEW_PROFILE_STATE_DIR,
  PROFILE_STATE_FILES,
  profileStateLayout,
} from "./profile-state.js";
import { MANIFEST_RELATIVE } from "./evidence-provenance.js";
import { isBareYearSegment, isDatedSubjectSegment } from "./workspace-layout.js";

/**
 * Plans a persona's move to the current workspace layout.
 *
 * Nothing here writes. The plan is the product: an operator reads it, argues
 * with it, names the parts it could not name, and only then applies it. That
 * ordering is not politeness — a persona's evidence is often the only surviving
 * copy of an employer document, and a rename that strands a claim is discovered
 * weeks later when a resume fails validation for reasons nobody can reconstruct.
 *
 * ## What makes a move safe
 *
 * Claims anchor to path, content hash, and line range. A move preserves bytes,
 * so the hash and the line range are unchanged by construction and only the
 * path has to be repointed. That is why this migrates by *moving whole files*
 * and never by rewriting their contents: the moment a migration edits bytes it
 * owes every claim a re-verification it cannot perform.
 *
 * ## What makes a move refuse
 *
 * A directory whose date or subject cannot be determined is reported, never
 * guessed. `2025/` might mean the year the evidence describes or the year
 * somebody imported it, and the two produce different names. The operator
 * supplies the name; the tool supplies everything else.
 */

const AMBIGUOUS = "ambiguous_name";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
}

function walkFiles(dir, personaRoot, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, personaRoot, out);
    else if (entry.isFile()) out.push(toPosix(path.relative(personaRoot, absolute)));
  }
  return out;
}

/**
 * Step 1: relocate the compiled ledgers.
 *
 * Safe on its own. Claims point at their *sources*, never at the ledger that
 * records them, so moving the ledger repoints nothing and can be applied
 * without touching a single claim.
 */
function planProfileState(personaRoot) {
  if (profileStateLayout(personaRoot) === "state") return [];
  const from = path.join(personaRoot, ...LEGACY_PROFILE_STATE_DIR.split("/"));
  const moves = [];
  for (const file of PROFILE_STATE_FILES) {
    const source = path.join(from, file);
    if (!fs.existsSync(source)) continue;
    moves.push({
      kind: "profile_state",
      from: `${LEGACY_PROFILE_STATE_DIR}/${file}`,
      to: `${NEW_PROFILE_STATE_DIR}/${file}`,
      hash: sha256(source),
    });
  }
  return moves;
}

/**
 * Step 2: propose an evidence package name for each capture-date directory.
 *
 * Only capture-date directories are candidates. Processing-stage layouts
 * (`raw/`, `extracted/`, `text/`, `validations/`) are left alone: converting
 * them to packages means deciding which of four files is *the* grounding record
 * and discarding the rest, which is a content decision rather than a move.
 */
function planEvidence(personaRoot, names) {
  const evidenceRoot = path.join(personaRoot, "evidence");
  const moves = [];
  const questions = [];
  if (!fs.existsSync(evidenceRoot)) return { moves, questions };

  const stageNames = new Set(["raw", "extracted", "text", "validations"]);

  for (const type of listDirs(evidenceRoot)) {
    const typeDir = path.join(evidenceRoot, type.name);
    const children = listDirs(typeDir);
    if (children.some((c) => stageNames.has(c.name))) continue;

    for (const item of children) {
      const relative = `evidence/${type.name}/${item.name}`;
      if (isDatedSubjectSegment(item.name)) continue;

      const supplied = names.get(relative) || names.get(item.name);
      if (!supplied) {
        questions.push({
          path: relative,
          reason: isBareYearSegment(item.name)
            ? "A bare year does not say whether it is when the evidence was written or when it was imported, and the two produce different names."
            : "This directory has no date-plus-subject name, so a correct one cannot be derived from it.",
          code: AMBIGUOUS,
          supplyWith: `--name ${relative}=<YYYY[-MM[-DD]]>-<subject>`,
        });
        continue;
      }
      if (!isDatedSubjectSegment(supplied)) {
        questions.push({
          path: relative,
          reason: `The supplied name "${supplied}" is not <YYYY[-MM[-DD]]>-<subject> in lowercase kebab-case.`,
          code: "invalid_supplied_name",
          supplyWith: `--name ${relative}=<YYYY[-MM[-DD]]>-<subject>`,
        });
        continue;
      }

      const itemDir = path.join(typeDir, item.name);
      for (const file of walkFiles(itemDir, personaRoot)) {
        const tail = file.slice(`${relative}/`.length);
        moves.push({
          kind: "evidence",
          from: file,
          to: `evidence/${type.name}/${supplied}/${tail}`,
          hash: sha256(path.join(personaRoot, ...file.split("/"))),
        });
      }
    }
  }
  return { moves, questions };
}

/**
 * Every ledger and manifest reference that has to follow a moved file.
 *
 * A move that repoints the claim but forgets `evidence/PROVENANCE.json` leaves
 * the file groundable and its provenance undeclared, which renders as a missing
 * classification rather than as an error — the quiet failure this whole area
 * keeps producing.
 */
function planReanchors(personaRoot, moves) {
  const byFrom = new Map(moves.filter((m) => m.kind === "evidence").map((m) => [m.from, m.to]));
  const reanchors = [];
  const problems = [];
  if (!byFrom.size) return { reanchors, problems };

  const layout = profileStateLayout(personaRoot);
  const stateRel = layout === "state" ? NEW_PROFILE_STATE_DIR : LEGACY_PROFILE_STATE_DIR;
  const claimsRel = `${stateRel}/claims.json`;
  const claimsAbs = path.join(personaRoot, ...claimsRel.split("/"));

  if (fs.existsSync(claimsAbs)) {
    let ledger;
    try {
      ledger = JSON.parse(fs.readFileSync(claimsAbs, "utf8"));
    } catch {
      problems.push({ file: claimsRel, reason: "unreadable_ledger" });
      ledger = null;
    }
    for (const claim of ledger?.claims || []) {
      for (const source of [...(claim.sources || []), ...(claim.externalSources || [])]) {
        const to = byFrom.get(source.path);
        if (!to) continue;
        const move = moves.find((m) => m.from === source.path);
        // The integrity gate. A claim may only follow a file whose bytes are
        // the ones it was verified against; anything else would repoint a claim
        // at content nobody checked.
        if (source.fileHash && move && source.fileHash !== move.hash) {
          problems.push({ file: claimsRel, claimId: claim.id, path: source.path, reason: "hash_mismatch" });
          continue;
        }
        reanchors.push({ file: claimsRel, claimId: claim.id, from: source.path, to });
      }
    }
  }

  const manifestAbs = path.join(personaRoot, MANIFEST_RELATIVE);
  if (fs.existsSync(manifestAbs)) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestAbs, "utf8"));
    } catch {
      problems.push({ file: toPosix(MANIFEST_RELATIVE), reason: "unreadable_manifest" });
      manifest = null;
    }
    for (const entry of manifest?.sources || []) {
      const to = byFrom.get(entry.path);
      if (!to) continue;
      reanchors.push({ file: toPosix(MANIFEST_RELATIVE), from: entry.path, to });
    }
  }

  return { reanchors, problems };
}

/**
 * @param {string} personaRoot
 * @param {Map<string,string>} names operator-supplied directory names
 */
export function planWorkspaceMigration(personaRoot, names = new Map()) {
  const profileMoves = planProfileState(personaRoot);
  const { moves: evidenceMoves, questions } = planEvidence(personaRoot, names);
  const moves = [...profileMoves, ...evidenceMoves];

  const collisions = [];
  const seen = new Set();
  for (const move of moves) {
    if (seen.has(move.to)) collisions.push({ to: move.to, reason: "two_sources_one_destination" });
    seen.add(move.to);
    if (fs.existsSync(path.join(personaRoot, ...move.to.split("/")))) {
      collisions.push({ to: move.to, reason: "destination_exists" });
    }
  }

  const { reanchors, problems } = planReanchors(personaRoot, moves);

  return {
    persona: path.basename(personaRoot),
    moves,
    reanchors,
    questions,
    problems: [...problems, ...collisions],
    // A plan is applicable only when nothing is unresolved. Partial application
    // is the one outcome with no honest story: half a persona in each layout,
    // with claims pointing at both.
    applicable: questions.length === 0 && problems.length === 0 && collisions.length === 0 && moves.length > 0,
  };
}

/** The record that makes an applied migration reversible. */
export function migrationManifest(plan) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    persona: plan.persona,
    moves: plan.moves.map(({ kind, from, to, hash }) => ({ kind, from, to, hash })),
    reanchors: plan.reanchors,
  };
}
