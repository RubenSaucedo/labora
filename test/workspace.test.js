import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { personaSearchPaths, resolvePersonaRoot, primaryPersonasDir, PLUGIN_ROOT } from "../src/lib/workspace.js";

function tmpdir(prefix = "labora-ws-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
  return file;
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
  // or `scaffold-persona` would scaffold a persona into whatever directory the
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


test("the bundled example persona resolves from a cwd outside the plugin repo", () => {
  const elsewhere = tmpdir("labora-elsewhere-");
  const example = resolvePersonaRoot("example", { cwd: elsewhere, env: {} });
  assert.equal(example, path.join(PLUGIN_ROOT, "data", "personas", "example"));
  assert.ok(fs.existsSync(path.join(example, "profile", "contact.md")));
  assert.ok(fs.existsSync(path.join(example, "applications")));
});

test("a new missing persona resolves under the primary workspace", () => {
  const ws = tmpdir();
  fs.mkdirSync(path.join(ws, "personas"), { recursive: true });
  assert.equal(
    resolvePersonaRoot("new-person", { cwd: ws, env: { LABORA_WORKSPACE: ws } }),
    path.join(ws, "personas", "new-person")
  );
});
