import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { applyMigration, missingProfileFiles, planMigration } from "../src/lib/migrate-workspace.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "labora");

function write(root, relative, body) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
  return file;
}

function legacyPersona() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-migrate-"));
  write(root, "profile/contact.md", "Name: Jane Example\n");
  write(root, "evidence/reviews/2025/review.md", "Synthetic review notes.\n");
  write(root, "evidence/resumes/old.md", "Old resume text.\n");
  write(root, "profile/generated/claims.json", JSON.stringify({ claims: [] }, null, 2));
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [CLI, "workspace", "migrate", root, ...args], { encoding: "utf-8" });
}

test("planning moves legacy evidence/ files into sources/", () => {
  const plan = planMigration(legacyPersona());
  assert.deepEqual(plan.moves, [
    { from: "evidence/resumes/old.md", to: "sources/resumes/old.md" },
    { from: "evidence/reviews/2025/review.md", to: "sources/reviews/2025/review.md" },
  ]);
  assert.deepEqual(plan.collisions, []);
});

test("planning reports retired generated state without deleting it", () => {
  const plan = planMigration(legacyPersona());
  assert.deepEqual(plan.retired.map((entry) => entry.directory), ["profile/generated"]);
  assert.equal(plan.retired[0].files, 1);
  assert.match(plan.retired[0].reason, /no longer read/);
});

test("a destination collision is reported and excluded from moves", () => {
  const root = legacyPersona();
  write(root, "sources/reviews/2025/review.md", "already here\n");
  const plan = planMigration(root);
  assert.deepEqual(plan.collisions, [
    { from: "evidence/reviews/2025/review.md", to: "sources/reviews/2025/review.md" },
  ]);
  assert.ok(!plan.moves.some((move) => move.from === "evidence/reviews/2025/review.md"));
});

test("applyMigration moves files and prunes emptied evidence directories", () => {
  const root = legacyPersona();
  const applied = applyMigration(root, planMigration(root));
  assert.equal(applied.length, 2);
  assert.ok(fs.existsSync(path.join(root, "sources", "reviews", "2025", "review.md")));
  assert.ok(fs.existsSync(path.join(root, "sources", "resumes", "old.md")));
  assert.equal(fs.existsSync(path.join(root, "evidence")), false);
  assert.ok(
    fs.existsSync(path.join(root, "profile", "generated", "claims.json")),
    "retired generated state is reported, not deleted"
  );
});

test("missingProfileFiles names only the authored profile files not yet present", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-migrate-"));
  write(root, "profile/contact.md", "Name: Jane Example\n");
  assert.deepEqual(missingProfileFiles(root).sort(), [
    "background.md", "career.md", "search-preferences.json",
  ]);
});

test("the CLI is a dry run by default and changes nothing", () => {
  const root = legacyPersona();
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /evidence\/reviews\/2025\/review\.md -> sources\/reviews\/2025\/review\.md/);
  assert.match(result.stdout, /profile\/generated\//);
  assert.match(result.stdout, /Dry run/);
  assert.ok(fs.existsSync(path.join(root, "evidence", "reviews", "2025", "review.md")));
});

test("the CLI refuses collisions instead of overwriting", () => {
  const root = legacyPersona();
  write(root, "sources/reviews/2025/review.md", "already here\n");
  const result = run(root, "--apply");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /already exist at their destination/);
  assert.ok(fs.existsSync(path.join(root, "evidence", "reviews", "2025", "review.md")));
});

test("--apply moves only the files the plan marked movable", () => {
  const root = legacyPersona();
  const result = run(root, "--apply");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Moved 2 file\(s\)/);
  assert.ok(fs.existsSync(path.join(root, "sources", "reviews", "2025", "review.md")));
  assert.ok(!fs.existsSync(path.join(root, "evidence")));
});

test("a persona already on the current layout reports nothing to do", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-migrate-"));
  write(root, "profile/contact.md", "Name: Jane Example\n");
  write(root, "sources/notes.md", "body\n");
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already on the current layout/);
});
