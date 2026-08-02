import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseSnapshot,
  buildFact,
  claimIdFor,
  anchorRepoClaims,
} from "../src/tools/anchor-repo-claims.js";

const SNAPSHOT = `# Repositories

## devtool
Visibility: public
Languages: JavaScript, PowerShell
Commits attributed to example-dev on the default branch: 32
Created: 2026-06-18
Last pushed: 2026-07-31
License: MIT
README excerpt: An open-source Copilot plugin.

## platform-v0
Visibility: private
Languages: TypeScript
Commits attributed to example-dev on the default branch: 696
Created: 2025-09-17
Homepage: https://platform.example/trainer
Homepage reachable: HTTP 200 on 2026-08-01
README excerpt: Monorepo for the example platform.
`;

function personaFixture(markdown = SNAPSHOT, claims = []) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-repo-"));
  const personaRoot = path.join(repoRoot, "data", "personas", "tester");
  const snapDir = path.join(personaRoot, "evidence", "repositories", "2026-08-01");
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(path.join(snapDir, "repositories.md"), markdown);

  const genDir = path.join(personaRoot, "profile", "generated");
  fs.mkdirSync(genDir, { recursive: true });
  fs.writeFileSync(
    path.join(genDir, "claims.json"),
    JSON.stringify({ persona: "tester", claims }, null, 2),
  );
  return { repoRoot, personaRoot, snapDir };
}

test("parseSnapshot splits repositories into anchored blocks", () => {
  const blocks = parseSnapshot(SNAPSHOT);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].name, "devtool");
  assert.equal(blocks[0].fields.Visibility, "public");
  assert.ok(blocks[0].lineStart < blocks[0].lineEnd);
  assert.ok(blocks[1].lineStart > blocks[0].lineEnd);
});

test("claim facts never contain volatile counters", () => {
  for (const block of parseSnapshot(SNAPSHOT)) {
    const fact = buildFact(block);
    assert.ok(!fact.includes("696"), "commit count leaked into fact");
    assert.ok(!fact.includes("32"), "commit count leaked into fact");
    assert.ok(!/Last pushed/i.test(fact), "last-pushed date leaked into fact");
  }
});

test("claim facts carry visibility and verified product reachability", () => {
  const blocks = parseSnapshot(SNAPSHOT);
  const devtool = buildFact(blocks[0]);
  const platform = buildFact(blocks[1]);

  assert.match(devtool, /devtool is a public repository/);
  assert.match(platform, /platform-v0 is a private repository/);
  assert.match(platform, /Homepage: https:\/\/platform\.example\/trainer/);
  assert.match(platform, /HTTP 200/);
});

test("claim ids are stable across repository casing", () => {
  assert.equal(claimIdFor("Algorithms"), "claim-repo-algorithms");
  assert.equal(
    claimIdFor("MyFirebaseAuthentication_AuthUI"),
    "claim-repo-myfirebaseauthentication-authui",
  );
});

test("re-anchoring rewrites hash and lines while preserving non-repository claims", () => {
  const { repoRoot, personaRoot } = personaFixture(SNAPSHOT, [
    { id: "claim-role-1", fact: "unrelated", sources: [] },
    {
      id: "claim-repo-devtool",
      type: "project",
      fact: "devtool is a private repository with 695 commits.",
      sources: [{ path: "stale.md", fileHash: "deadbeef", lineStart: 1, lineEnd: 2 }],
      disclosure: "internal_generalizable",
    },
  ]);

  const result = anchorRepoClaims({ personaRoot, repoRoot });
  const ledger = JSON.parse(
    fs.readFileSync(path.join(personaRoot, "profile", "generated", "claims.json"), "utf8"),
  );

  assert.equal(result.count, 2);
  assert.ok(ledger.claims.some((c) => c.id === "claim-role-1"));

  const devtool = ledger.claims.find((c) => c.id === "claim-repo-devtool");
  assert.ok(!devtool.fact.includes("695"), "stale commit count survived re-anchoring");
  assert.match(devtool.fact, /public repository/);
  assert.notEqual(devtool.sources[0].fileHash, "deadbeef");
  assert.match(devtool.sources[0].path, /repositories\.md$/);
  assert.equal(devtool.disclosure, "internal_generalizable", "disclosure must be preserved");
});

test("re-anchoring reports claims whose repository left the snapshot", () => {
  const { repoRoot, personaRoot } = personaFixture(SNAPSHOT, [
    { id: "claim-repo-deleted-repo", type: "project", fact: "gone", sources: [] },
  ]);

  const result = anchorRepoClaims({ personaRoot, repoRoot });
  assert.deepEqual(result.dropped, ["claim-repo-deleted-repo"]);
});
