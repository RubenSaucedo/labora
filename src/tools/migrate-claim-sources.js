#!/usr/bin/env node
// Rewrite claim source paths from repo-relative to persona-relative.
//
// Provenance must travel with the persona. Sources were originally recorded as
// `data/personas/<name>/profile/background.md` — a path that only resolves from
// this repository's root. Once persona data moves to a private workspace, every
// such path is stranded and the whole ledger fails `source_missing`.
//
// This is a mechanical migration, not an edit to curated content: only the
// `path` field changes, and only when the file at the new location hashes
// identically to the `fileHash` recorded at verification time. That hash is
// what makes the rewrite safe to run on generated files — it proves the claim
// still points at byte-identical content, so no claim silently changes meaning.
// If any source fails that check the file is left completely untouched.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolvePersonaRoot } from "../lib/workspace.js";

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function withinDir(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function planMigration(ledger, personaRoot) {
  const root = path.resolve(personaRoot);
  const changes = [];
  const problems = [];

  for (const claim of ledger.claims || []) {
    // A claim carries provenance in two arrays: `sources` grounds the internal
    // fact, `externalSources` grounds the externally-disclosable rewrite. Both
    // are load-bearing, so both must be repointed or the disclosure variant is
    // silently stranded while the claim still appears valid.
    for (const source of [...(claim.sources || []), ...(claim.externalSources || [])]) {
      const current = source.path;
      if (typeof current !== "string" || !current) continue;

      const asPersonaRelative = path.resolve(root, current);
      // Already portable and present: nothing to do.
      if (withinDir(root, asPersonaRelative) && fs.existsSync(asPersonaRelative)) continue;

      // Legacy form: a repo-relative path whose tail is inside this persona.
      const marker = `${path.basename(root)}${path.sep}`;
      const idx = current.replace(/\//g, path.sep).indexOf(marker);
      if (idx === -1) {
        problems.push({ claimId: claim.id, path: current, reason: "not_a_persona_path" });
        continue;
      }
      const tail = current.replace(/\//g, path.sep).slice(idx + marker.length);
      const target = path.resolve(root, tail);
      if (!withinDir(root, target)) {
        problems.push({ claimId: claim.id, path: current, reason: "escapes_persona_root" });
        continue;
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        problems.push({ claimId: claim.id, path: current, reason: "missing_at_target" });
        continue;
      }
      // The integrity gate: identical bytes, or we do not touch the ledger.
      if (source.fileHash && sha256(target) !== source.fileHash) {
        problems.push({ claimId: claim.id, path: current, reason: "hash_mismatch" });
        continue;
      }
      changes.push({ claimId: claim.id, from: current, to: tail.split(path.sep).join("/"), source });
    }
  }
  return { changes, problems };
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const persona = args.find((a) => !a.startsWith("--"));
  if (!persona) {
    console.error("usage: node src/tools/migrate-claim-sources.js <persona> [--write]");
    process.exit(1);
  }

  const personaRoot = resolvePersonaRoot(persona);
  const claimsPath = path.join(personaRoot, "profile", "generated", "claims.json");
  if (!fs.existsSync(claimsPath)) {
    console.error(`no ledger at ${claimsPath}`);
    process.exit(1);
  }

  const ledger = JSON.parse(fs.readFileSync(claimsPath, "utf-8"));
  const { changes, problems } = planMigration(ledger, personaRoot);

  console.log(`persona root: ${personaRoot}`);
  console.log(`${changes.length} source path(s) to repoint, ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  [problem] ${p.claimId}: ${p.reason} -> ${p.path}`);

  if (problems.length > 0) {
    console.error("\nrefusing to write: every source must repoint to byte-identical content.");
    process.exit(1);
  }
  if (!write) {
    const sample = changes.slice(0, 3);
    for (const c of sample) console.log(`  ${c.from}\n    -> ${c.to}`);
    if (changes.length > sample.length) console.log(`  ... and ${changes.length - sample.length} more`);
    console.log("\ndry run. re-run with --write to apply.");
    process.exit(0);
  }

  for (const c of changes) c.source.path = c.to;
  fs.writeFileSync(claimsPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
  console.log(`\nrepointed ${changes.length} source path(s) -> ${claimsPath}`);
}
