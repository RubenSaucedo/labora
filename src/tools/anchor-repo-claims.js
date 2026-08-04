#!/usr/bin/env node
// Regenerate the repository claims from the latest `snapshot-repos` output.
//
// Repository facts are mechanical derivations of a tool-generated file, so they
// belong in deterministic code rather than in a model's judgement. Re-running
// the snapshot changes the file hash and line numbers of every block, which
// would otherwise strand every `claim-repo-*` entry in the ledger.
//
// Only durable fields enter a claim fact. Commit counts and last-pushed dates
// change on the author's next push, and claim facts are re-verified against
// their source, so a volatile number breaks the ledger as soon as work lands.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolvePersonaRoot } from "../lib/workspace.js";

const VOLATILE_FIELDS = new Set(["Commits attributed", "Last pushed"]);
const CLAIM_PREFIX = "claim-repo-";

export function parseSnapshot(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  let current = null;

  lines.forEach((line, index) => {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      if (current) blocks.push(current);
      current = { name: heading[1].trim(), lineStart: index + 1, lineEnd: index + 1, fields: {} };
      return;
    }
    if (!current) return;
    if (line.trim() !== "") current.lineEnd = index + 1;
    const field = /^([^:]+):\s*(.*)$/.exec(line);
    if (field) current.fields[field[1].trim()] = field[2].trim();
  });
  if (current) blocks.push(current);
  return blocks;
}

function isVolatile(label) {
  for (const prefix of VOLATILE_FIELDS) {
    if (label.startsWith(prefix)) return true;
  }
  return false;
}

// Claim ids must stay stable across snapshots, so they are slugged rather than
// taken verbatim: GitHub preserves repository casing and underscores, and a
// rename of `Algorithms` to `algorithms` would otherwise orphan the claim.
export function claimIdFor(repoName) {
  const slug = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${CLAIM_PREFIX}${slug}`;
}

export function buildFact(block) {
  const f = block.fields;
  const visibility = f.Visibility || "unlisted";
  const parts = [];

  parts.push(
    f.Languages
      ? `${block.name} is a ${visibility} repository built in ${f.Languages}.`
      : `${block.name} is a ${visibility} repository.`,
  );
  if (f.Created) parts.push(`Created: ${f.Created}.`);
  if (f.License) parts.push(`License: ${f.License}.`);
  if (f.Homepage) parts.push(`Homepage: ${f.Homepage}.`);
  if (f["Homepage reachable"]) parts.push(`Homepage reachable: ${f["Homepage reachable"]}.`);

  const readme = f["README excerpt"];
  if (readme) parts.push(readme);

  return parts.join(" ");
}

function latestSnapshotDir(personaRoot) {
  const base = path.join(personaRoot, "evidence", "repositories");
  if (!fs.existsSync(base)) throw new Error(`no repository evidence at ${base}`);
  const dated = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (dated.length === 0) throw new Error(`no dated snapshot under ${base}`);
  return path.join(base, dated[dated.length - 1]);
}

export function anchorRepoClaims({ personaRoot, repoRoot = process.cwd() }) {
  const snapshotDir = latestSnapshotDir(personaRoot);
  const mdPath = path.join(snapshotDir, "repositories.md");
  const markdown = fs.readFileSync(mdPath, "utf8");
  const fileHash = crypto.createHash("sha256").update(markdown).digest("hex");
  const relPath = path.relative(repoRoot, mdPath).split(path.sep).join("/");

  const blocks = parseSnapshot(markdown);
  const ledgerPath = path.join(personaRoot, "profile", "generated", "claims.json");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));

  const kept = ledger.claims.filter((c) => !c.id.startsWith(CLAIM_PREFIX));
  const previous = new Map(
    ledger.claims.filter((c) => c.id.startsWith(CLAIM_PREFIX)).map((c) => [c.id, c]),
  );

  const rebuilt = blocks.map((block) => {
    const id = claimIdFor(block.name);
    const createdYear = (block.fields.Created || "").slice(0, 4);
    const prior = previous.get(id);
    return {
      id,
      type: "project",
      fact: buildFact(block),
      period: createdYear ? `${createdYear}–present` : (prior?.period ?? ""),
      sources: [
        {
          path: relPath,
          fileHash,
          lineStart: block.lineStart,
          lineEnd: block.lineEnd,
          page: null,
          extraction: "markdown",
          confidence: 1,
        },
      ],
      status: "verified",
      disclosure: prior?.disclosure ?? "public",
      externalFact: prior?.externalFact ?? "",
      externalSources: prior?.externalSources ?? [],
    };
  });

  ledger.claims = [...kept, ...rebuilt];
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  const dropped = [...previous.keys()].filter((id) => !rebuilt.some((c) => c.id === id));
  return { snapshotDir, mdPath, count: rebuilt.length, dropped, claims: rebuilt };
}

function parseArgs(argv) {
  const args = { persona: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--persona") args.persona = argv[i + 1];
  }
  return args;
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const { persona } = parseArgs(process.argv.slice(2));
  if (!persona) {
    console.error("usage: node src/tools/anchor-repo-claims.js --persona <name>");
    process.exit(1);
  }
  const personaRoot = resolvePersonaRoot(persona);
  const result = anchorRepoClaims({ personaRoot });
  console.log(
    `re-anchored ${result.count} repository claims -> ${path.relative(process.cwd(), result.mdPath)}`,
  );
  for (const id of result.dropped) console.log(`  dropped (repo no longer in snapshot): ${id}`);
}
