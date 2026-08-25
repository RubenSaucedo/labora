import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { planWorkspaceMigration, migrationManifest } from "../src/lib/migrate-workspace.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "labora");

function sha256(body) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function write(root, relative, body) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
  return file;
}

/** A persona with legacy ledgers, one bare-year evidence directory, and a claim citing it. */
function legacyPersona({ evidenceBody = "Shipped the migration.\n" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-migrate-"));
  write(root, "profile/background.md", "# Background\n");
  write(root, "evidence/reviews/2025/evidence.md", evidenceBody);
  write(root, "profile/generated/identity.json", JSON.stringify({ schema_version: "4.0" }, null, 2));
  write(root, "profile/generated/accomplishments.json", JSON.stringify({ units: [] }, null, 2));
  write(
    root,
    "profile/generated/claims.json",
    JSON.stringify(
      {
        claims: [
          {
            id: "claim-one",
            fact: "Shipped the migration.",
            sources: [
              { path: "evidence/reviews/2025/evidence.md", fileHash: sha256(evidenceBody), lineRange: [1, 1] },
            ],
          },
        ],
      },
      null,
      2
    )
  );
  write(
    root,
    "evidence/PROVENANCE.json",
    JSON.stringify(
      { sources: [{ path: "evidence/reviews/2025/evidence.md", contentHash: sha256(evidenceBody) }] },
      null,
      2
    )
  );
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [CLI, "migrate-workspace", root, ...args], { encoding: "utf-8" });
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relative.split("/")), "utf-8"));
}

test("the ledgers are proposed for relocation without touching a single claim", () => {
  const root = legacyPersona();
  const plan = planWorkspaceMigration(root);
  const stateMoves = plan.moves.filter((m) => m.kind === "profile_state");
  assert.equal(stateMoves.length, 3);
  // Claims cite sources, never the ledger recording them, so a ledger move
  // repoints nothing.
  assert.equal(plan.reanchors.filter((r) => r.from.includes("generated")).length, 0);
});

test("a bare-year evidence directory is asked about, never guessed", () => {
  const plan = planWorkspaceMigration(legacyPersona());
  const question = plan.questions.find((q) => q.path === "evidence/reviews/2025");
  assert.ok(question, JSON.stringify(plan.questions));
  assert.equal(question.code, "ambiguous_name");
  assert.match(question.reason, /when it was imported/);
  assert.match(question.supplyWith, /--name evidence\/reviews\/2025=/);
});

test("an unanswered question makes the whole plan inapplicable, never partially applied", () => {
  const plan = planWorkspaceMigration(legacyPersona());
  assert.equal(plan.applicable, false);
  assert.ok(plan.moves.length > 0, "the safe moves are still shown, they are just not runnable yet");
});

test("a supplied name that is not date-plus-subject is refused rather than used", () => {
  const root = legacyPersona();
  const plan = planWorkspaceMigration(root, new Map([["evidence/reviews/2025", "Reviews_2025"]]));
  const problem = plan.questions.find((q) => q.code === "invalid_supplied_name");
  assert.ok(problem, JSON.stringify(plan.questions));
  assert.equal(plan.applicable, false);
});

test("a named package moves every file in it and repoints both the ledger and the manifest", () => {
  const root = legacyPersona();
  const plan = planWorkspaceMigration(root, new Map([["evidence/reviews/2025", "2025-03-annual-review"]]));
  assert.equal(plan.applicable, true, JSON.stringify({ q: plan.questions, p: plan.problems }));

  const evidenceMove = plan.moves.find((m) => m.kind === "evidence");
  assert.equal(evidenceMove.to, "evidence/reviews/2025-03-annual-review/evidence.md");

  const files = plan.reanchors.map((r) => r.file);
  assert.ok(files.some((f) => f.endsWith("claims.json")), "the claim must follow the file");
  assert.ok(
    files.some((f) => f.endsWith("PROVENANCE.json")),
    "provenance must follow too, or the file stays groundable with its classification stranded"
  );
});

test("a claim whose recorded hash disagrees with the file blocks the migration", () => {
  const root = legacyPersona();
  write(root, "evidence/reviews/2025/evidence.md", "Different bytes entirely.\n");
  const plan = planWorkspaceMigration(root, new Map([["evidence/reviews/2025", "2025-03-annual-review"]]));
  const problem = plan.problems.find((p) => p.reason === "hash_mismatch");
  assert.ok(problem, JSON.stringify(plan.problems));
  assert.equal(plan.applicable, false);
});

test("a destination that already exists is refused instead of overwritten", () => {
  const root = legacyPersona();
  write(root, "evidence/reviews/2025-03-annual-review/evidence.md", "occupied\n");
  const plan = planWorkspaceMigration(root, new Map([["evidence/reviews/2025", "2025-03-annual-review"]]));
  assert.ok(plan.problems.some((p) => p.reason === "destination_exists"), JSON.stringify(plan.problems));
  assert.equal(plan.applicable, false);
});

test("processing-stage evidence is left alone, because choosing the grounding file is a content decision", () => {
  const root = legacyPersona();
  for (const stage of ["raw", "extracted", "text", "validations"]) {
    write(root, `evidence/performance-reviews/${stage}/review.md`, `${stage}\n`);
  }
  const plan = planWorkspaceMigration(root, new Map([["evidence/reviews/2025", "2025-03-annual-review"]]));
  assert.equal(plan.moves.filter((m) => m.from.includes("performance-reviews")).length, 0);
  assert.equal(plan.questions.filter((q) => q.path.includes("performance-reviews")).length, 0);
});

test("the CLI is a dry run by default and changes nothing", () => {
  const root = legacyPersona();
  const before = fs.readdirSync(path.join(root, "profile", "generated")).sort();
  const result = run(root);
  // Reporting an open question is the tool doing its job, not failing.
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /answer the questions above/);
  assert.deepEqual(fs.readdirSync(path.join(root, "profile", "generated")).sort(), before);
});

test("--apply on an unresolved plan is refused, and says so on stderr", () => {
  const root = legacyPersona();
  const result = run(root, "--apply");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to apply/);
  assert.ok(fs.existsSync(path.join(root, "profile", "generated", "claims.json")));
});

test("--apply moves the files, repoints the references, and leaves a reversible manifest", () => {
  const root = legacyPersona();
  const applied = run(root, "--name", "evidence/reviews/2025=2025-03-annual-review", "--apply");
  assert.equal(applied.status, 0, applied.stderr);

  assert.ok(fs.existsSync(path.join(root, ".labora", "state", "profile", "claims.json")));
  assert.ok(fs.existsSync(path.join(root, "evidence", "reviews", "2025-03-annual-review", "evidence.md")));
  assert.ok(!fs.existsSync(path.join(root, "evidence", "reviews", "2025")), "the old directory is pruned");

  const ledger = readJson(root, ".labora/state/profile/claims.json");
  assert.equal(ledger.claims[0].sources[0].path, "evidence/reviews/2025-03-annual-review/evidence.md");
  // The bytes never changed, so the anchor that proves it must not change either.
  assert.deepEqual(ledger.claims[0].sources[0].lineRange, [1, 1]);
  assert.equal(
    readJson(root, "evidence/PROVENANCE.json").sources[0].path,
    "evidence/reviews/2025-03-annual-review/evidence.md"
  );

  const manifests = fs.readdirSync(path.join(root, ".labora", "state", "migrations"));
  assert.equal(manifests.length, 1);
});

test("--revert restores the tree and the references exactly", () => {
  const root = legacyPersona();
  const originalLedger = readJson(root, "profile/generated/claims.json");

  run(root, "--name", "evidence/reviews/2025=2025-03-annual-review", "--apply");
  const manifestDir = path.join(root, ".labora", "state", "migrations");
  const manifest = path.join(manifestDir, fs.readdirSync(manifestDir)[0]);

  const reverted = run(root, "--revert", manifest);
  assert.equal(reverted.status, 0, reverted.stderr);

  assert.ok(fs.existsSync(path.join(root, "evidence", "reviews", "2025", "evidence.md")));
  assert.ok(!fs.existsSync(path.join(root, "evidence", "reviews", "2025-03-annual-review")));
  assert.deepEqual(readJson(root, "profile/generated/claims.json"), originalLedger);
});

test("--revert refuses when a migrated file changed afterwards", () => {
  const root = legacyPersona();
  run(root, "--name", "evidence/reviews/2025=2025-03-annual-review", "--apply");
  const manifestDir = path.join(root, ".labora", "state", "migrations");
  const manifest = path.join(manifestDir, fs.readdirSync(manifestDir)[0]);

  write(root, "evidence/reviews/2025-03-annual-review/evidence.md", "edited after migrating\n");
  const reverted = run(root, "--revert", manifest);
  assert.notEqual(reverted.status, 0);
  assert.match(reverted.stderr, /changed after the migration/);
  // Refusing must be total: nothing may be half-restored.
  assert.ok(fs.existsSync(path.join(root, "evidence", "reviews", "2025-03-annual-review", "evidence.md")));
});

test("a persona already on the current layout reports nothing to do", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-migrate-"));
  write(root, "profile/background.md", "# Background\n");
  write(root, ".labora/state/profile/claims.json", JSON.stringify({ claims: [] }, null, 2));
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already uses the current layout/);
});

test("the manifest records enough to reverse every move", () => {
  const root = legacyPersona();
  const plan = planWorkspaceMigration(root, new Map([["evidence/reviews/2025", "2025-03-annual-review"]]));
  const manifest = migrationManifest(plan);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.moves.length, plan.moves.length);
  for (const move of manifest.moves) {
    assert.ok(move.from && move.to && move.hash, JSON.stringify(move));
  }
});
