import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scriptSource = path.resolve("scripts/migrate-to-personas.sh");

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-migrate-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(scriptSource, path.join(root, "scripts", "migrate-to-personas.sh"));
  return root;
}

test("migration aborts before moving when a destination collides", () => {
  const root = setupRepo();
  const oldProfile = path.join(root, "data", "applicant", "jane");
  const newProfile = path.join(root, "data", "personas", "jane", "profile");
  fs.mkdirSync(oldProfile, { recursive: true });
  fs.mkdirSync(newProfile, { recursive: true });
  fs.writeFileSync(path.join(oldProfile, "jane-career.md"), "old");
  fs.writeFileSync(path.join(newProfile, "career.md"), "existing");

  const result = spawnSync("bash", [path.join(root, "scripts", "migrate-to-personas.sh")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(oldProfile, "jane-career.md"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(newProfile, "career.md"), "utf8"), "existing");
});

test("migration preserves nested evidence paths with duplicate basenames", () => {
  const root = setupRepo();
  const source = path.join(root, "data", "applicant", "jane", "connects-pdf");
  fs.mkdirSync(path.join(source, "2024"), { recursive: true });
  fs.mkdirSync(path.join(source, "2025"), { recursive: true });
  fs.writeFileSync(path.join(source, "2024", "review.pdf"), "2024");
  fs.writeFileSync(path.join(source, "2025", "review.pdf"), "2025");

  const result = spawnSync("bash", [path.join(root, "scripts", "migrate-to-personas.sh")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const target = path.join(root, "data", "personas", "jane", "evidence", "performance-reviews", "raw");
  assert.equal(fs.readFileSync(path.join(target, "2024", "review.pdf"), "utf8"), "2024");
  assert.equal(fs.readFileSync(path.join(target, "2025", "review.pdf"), "utf8"), "2025");
});

test("a later persona collision prevents every earlier move", () => {
  const root = setupRepo();
  const alice = path.join(root, "data", "applicant", "alice");
  const bob = path.join(root, "data", "applicant", "bob");
  fs.mkdirSync(alice, { recursive: true });
  fs.mkdirSync(bob, { recursive: true });
  fs.writeFileSync(path.join(alice, "alice-career.md"), "alice source");
  fs.writeFileSync(path.join(bob, "bob-career.md"), "bob source");
  const bobTarget = path.join(root, "data", "personas", "bob", "profile");
  fs.mkdirSync(bobTarget, { recursive: true });
  fs.writeFileSync(path.join(bobTarget, "career.md"), "bob existing");

  const result = spawnSync("bash", [path.join(root, "scripts", "migrate-to-personas.sh")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(alice, "alice-career.md"), "utf8"), "alice source");
  assert.equal(fs.existsSync(path.join(root, "data", "personas", "alice", "profile", "career.md")), false);
});
