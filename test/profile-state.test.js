import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  LEGACY_PROFILE_STATE_DIR,
  NEW_PROFILE_STATE_DIR,
  PROFILE_STATE_FILES,
  personaRootFromStateFile,
  profileStateDir,
  profileStateLayout,
  profileStatePath,
} from "../src/lib/profile-state.js";

function persona() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "labora-state-"));
}

function writeLedger(root, relativeDir, file = "identity.json") {
  const dir = path.join(root, ...relativeDir.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), "{}\n", "utf-8");
  return dir;
}

test("a persona with no compiled state builds into the new location", () => {
  const root = persona();
  assert.equal(profileStateLayout(root), "state");
  assert.equal(profileStateDir(root), path.join(root, ".labora", "state", "profile"));
});

test("a persona whose ledgers live under profile/generated keeps writing there", () => {
  const root = persona();
  const legacy = writeLedger(root, LEGACY_PROFILE_STATE_DIR);
  assert.equal(profileStateLayout(root), "legacy");
  assert.equal(profileStateDir(root), legacy);
});

test("a persona already on the new layout is never pulled back to the legacy one", () => {
  const root = persona();
  writeLedger(root, LEGACY_PROFILE_STATE_DIR);
  const current = writeLedger(root, NEW_PROFILE_STATE_DIR);
  assert.equal(profileStateLayout(root), "state");
  assert.equal(profileStateDir(root), current);
});

test("an empty scaffolded generated/ does not pin a new persona to the legacy layout forever", () => {
  const root = persona();
  // A README-only placeholder is a scaffold, not a claim on the layout...
  fs.mkdirSync(path.join(root, "profile", "generated"), { recursive: true });
  fs.writeFileSync(path.join(root, "profile", "generated", "README.md"), "ownership\n", "utf-8");
  assert.equal(profileStateLayout(root), "legacy");

  // ...but once a real ledger lands there, that is where state lives.
  writeLedger(root, LEGACY_PROFILE_STATE_DIR, "claims.json");
  assert.equal(profileStateLayout(root), "legacy");
});

test("any one of the three ledgers is enough to identify the layout", () => {
  for (const file of PROFILE_STATE_FILES) {
    const root = persona();
    writeLedger(root, NEW_PROFILE_STATE_DIR, file);
    assert.equal(profileStateLayout(root), "state", file);
  }
});

test("the resolver never reports a location that would split state across two directories", () => {
  const root = persona();
  writeLedger(root, LEGACY_PROFILE_STATE_DIR);
  const first = profileStateDir(root);
  // Reading must not migrate anything: a read that moves files would strand
  // every other tool mid-run.
  assert.equal(profileStateDir(root), first);
  assert.ok(!fs.existsSync(path.join(root, ".labora")));
});

test("a persona root is recovered identically from either layout", () => {
  const root = persona();
  const fromNew = personaRootFromStateFile(path.join(root, ".labora", "state", "profile", "identity.json"));
  const fromLegacy = personaRootFromStateFile(path.join(root, "profile", "generated", "identity.json"));
  assert.equal(fromNew, root);
  assert.equal(fromLegacy, root);
});

test("a ledger at the older profile/ root still resolves to the persona", () => {
  const root = persona();
  assert.equal(personaRootFromStateFile(path.join(root, "profile", "identity.json")), root);
});

test("a persona whose own directory is named profile is not mistaken for its parent", () => {
  const root = persona();
  const nested = path.join(root, "personas", "profile");
  assert.equal(
    personaRootFromStateFile(path.join(nested, ".labora", "state", "profile", "claims.json")),
    nested
  );
});

test("profileStatePath composes the resolved directory with the ledger name", () => {
  const root = persona();
  writeLedger(root, LEGACY_PROFILE_STATE_DIR);
  assert.equal(
    profileStatePath(root, "claims.json"),
    path.join(root, "profile", "generated", "claims.json")
  );
});

test("storage getters follow the resolver rather than a hardcoded path", async () => {
  const ws = persona();
  const name = "layout-fixture";
  const root = path.join(ws, "personas", name);
  writeLedger(root, LEGACY_PROFILE_STATE_DIR, "claims.json");

  const previous = process.env.LABORA_WORKSPACE;
  const cwd = process.cwd();
  process.env.LABORA_WORKSPACE = ws;
  process.chdir(ws);
  try {
    const storage = await import(`../src/lib/storage.js?state=${Date.now()}`);
    assert.equal(storage.getClaimsPath(name), path.join(root, "profile", "generated", "claims.json"));
    assert.equal(
      storage.personaRootFromProfileFile(storage.getClaimsPath(name)),
      root
    );
  } finally {
    process.chdir(cwd);
    if (previous === undefined) delete process.env.LABORA_WORKSPACE;
    else process.env.LABORA_WORKSPACE = previous;
  }
});
