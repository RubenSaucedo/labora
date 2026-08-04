import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { personaSearchPaths, resolvePersonaRoot, primaryPersonasDir, PLUGIN_ROOT } from "../src/lib/workspace.js";
import { validateProfile } from "../src/tools/validate-profile.js";
import { planMigration } from "../src/tools/migrate-claim-sources.js";

function tmpdir(prefix = "labora-ws-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
  return file;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("LABORA_WORKSPACE takes precedence and resolves personas/ under it", () => {
  const ws = tmpdir();
  fs.mkdirSync(path.join(ws, "personas", "ruben"), { recursive: true });
  const roots = personaSearchPaths({ cwd: ws, env: { LABORA_WORKSPACE: ws } });
  assert.equal(roots[0], path.join(ws, "personas"));
  assert.equal(resolvePersonaRoot("ruben", { cwd: ws, env: { LABORA_WORKSPACE: ws } }),
    path.join(ws, "personas", "ruben"));
});

test("a labora.json pointer resolves relative to the marker, not the cwd", () => {
  const parent = tmpdir();
  const repo = path.join(parent, "labora");
  const ws = path.join(parent, "labora-ruben");
  fs.mkdirSync(path.join(ws, "personas", "ruben"), { recursive: true });
  const nested = path.join(repo, "src", "tools");
  fs.mkdirSync(nested, { recursive: true });
  writeFile(path.join(repo, "labora.json"), JSON.stringify({ workspace: "../labora-ruben" }));

  // Invoked from a subdirectory, the relative pointer must still land on the
  // workspace; resolving against the cwd would silently miss.
  const resolved = resolvePersonaRoot("ruben", { cwd: nested, env: {} });
  assert.equal(fs.realpathSync(resolved), fs.realpathSync(path.join(ws, "personas", "ruben")));
});

test("a malformed labora.json is surfaced, not silently ignored", () => {
  const repo = tmpdir();
  writeFile(path.join(repo, "labora.json"), "{ not json");
  assert.throws(() => personaSearchPaths({ cwd: repo, env: {} }), /not valid JSON/);
});

test("the cwd itself is a workspace when it holds personas/ (zero-config plugin use)", () => {
  const ws = tmpdir();
  fs.mkdirSync(path.join(ws, "personas", "ruben"), { recursive: true });
  // No env, no labora.json: an installed plugin must find the workspace simply
  // because you ran it there. This is the primary path, not a fallback.
  const roots = personaSearchPaths({ cwd: ws, env: {} });
  assert.equal(roots[0], path.join(ws, "personas"));
  assert.equal(resolvePersonaRoot("ruben", { cwd: ws, env: {} }), path.join(ws, "personas", "ruben"));
});

test("an unrelated cwd does not become a persona write target", () => {
  const plain = tmpdir();
  // Without a personas/ directory the cwd must not be treated as a workspace,
  // or `new-applicant` would scaffold a persona into whatever directory the
  // operator happened to be standing in.
  const roots = personaSearchPaths({ cwd: plain, env: {} });
  assert.ok(!roots.includes(path.join(plain, "personas")),
    `bare cwd should not be a workspace root: ${JSON.stringify(roots)}`);
});

test("bundled personas stay reachable when an external workspace is configured", () => {
  const ws = tmpdir();
  fs.mkdirSync(path.join(ws, "personas", "ruben"), { recursive: true });
  const roots = personaSearchPaths({ cwd: ws, env: { LABORA_WORKSPACE: ws } });
  // The committed `example` fixture lives in the plugin repo; a configured
  // workspace must not hide it or the suite and docs break.
  assert.ok(roots.some((r) => r.endsWith(path.join("labora", "data", "personas"))),
    `bundled fixtures missing from ${JSON.stringify(roots)}`);
  const example = resolvePersonaRoot("example", { cwd: ws, env: { LABORA_WORKSPACE: ws } });
  assert.ok(fs.existsSync(example), "example persona should resolve from bundled data");
});

test("new personas are written to the workspace, not the plugin repo", () => {
  const ws = tmpdir();
  fs.mkdirSync(path.join(ws, "personas"), { recursive: true });
  assert.equal(primaryPersonasDir({ cwd: ws, env: { LABORA_WORKSPACE: ws } }),
    path.join(ws, "personas"));
});

test("the bundled example persona validates from a cwd outside the plugin repo", () => {
  // The reference fixture must be portable, because as a plugin it is almost
  // never run from its own checkout. Repo-relative claim sources resolved only
  // when the cwd happened to be the labora repo, so `example` silently reported
  // INVALID everywhere it actually matters.
  const exampleRoot = resolvePersonaRoot("example", { cwd: PLUGIN_ROOT, env: {} });
  const elsewhere = tmpdir("labora-elsewhere-");
  const { valid, issues } = validateProfile(exampleRoot, { repoRoot: elsewhere });
  const sourceIssues = issues.filter((i) => String(i.code).startsWith("source_"));
  assert.deepEqual(sourceIssues, [], `example must resolve its own sources from any cwd`);
  assert.equal(valid, true);
});

test("claim source migration repoints repo-relative paths to persona-relative", () => {
  const ws = tmpdir();
  const personaRoot = path.join(ws, "personas", "ruben");
  const bg = writeFile(path.join(personaRoot, "profile", "background.md"), "line one\nline two\n");
  const ledger = {
    claims: [
      {
        id: "claim-a",
        sources: [{ path: "data/personas/ruben/profile/background.md", fileHash: sha256(bg) }],
      },
    ],
  };
  const { changes, problems } = planMigration(ledger, personaRoot);
  assert.equal(problems.length, 0);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].to, "profile/background.md");
});

test("migration also repoints externalSources, not just sources", () => {
  const ws = tmpdir();
  const personaRoot = path.join(ws, "personas", "ruben");
  const ev = writeFile(path.join(personaRoot, "evidence", "performance-reviews", "2026", "text", "x.md"), "body\n");
  const ledger = {
    claims: [
      {
        id: "claim-b",
        sources: [],
        externalSources: [
          { path: "data/personas/ruben/evidence/performance-reviews/2026/text/x.md", fileHash: sha256(ev) },
        ],
      },
    ],
  };
  const { changes, problems } = planMigration(ledger, personaRoot);
  assert.equal(problems.length, 0);
  assert.equal(changes.length, 1,
    "externalSources grounds the disclosable rewrite; leaving it stale strands that variant silently");
  assert.equal(changes[0].to, "evidence/performance-reviews/2026/text/x.md");
});

test("migration refuses a source whose content no longer matches its recorded hash", () => {
  const ws = tmpdir();
  const personaRoot = path.join(ws, "personas", "ruben");
  writeFile(path.join(personaRoot, "profile", "background.md"), "content changed since verification\n");
  const ledger = {
    claims: [
      {
        id: "claim-c",
        sources: [{ path: "data/personas/ruben/profile/background.md", fileHash: "0".repeat(64) }],
      },
    ],
  };
  const { changes, problems } = planMigration(ledger, personaRoot);
  assert.equal(changes.length, 0);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].reason, "hash_mismatch",
    "repointing at different bytes would silently change what a verified claim asserts");
});

test("migration reports a source missing at the target rather than inventing one", () => {
  const ws = tmpdir();
  const personaRoot = path.join(ws, "personas", "ruben");
  fs.mkdirSync(personaRoot, { recursive: true });
  const ledger = {
    claims: [{ id: "claim-d", sources: [{ path: "data/personas/ruben/profile/gone.md", fileHash: "x" }] }],
  };
  const { changes, problems } = planMigration(ledger, personaRoot);
  assert.equal(changes.length, 0);
  assert.equal(problems[0].reason, "missing_at_target");
});
