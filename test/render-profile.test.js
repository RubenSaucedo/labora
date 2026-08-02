import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { renderProfile } from "../src/tools/render-profile.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleGenerated = path.join(repoRoot, "data/personas/example/profile/generated");

function renderExample() {
  return renderProfile("example", exampleGenerated);
}

test("renders a review surface for the example persona", () => {
  const markdown = renderExample();
  assert.match(markdown, /^# Profile review — example/);
  assert.match(markdown, /## At a glance/);
  assert.match(markdown, /## Experience/);
});

test("warns that the file is a view and must not be hand-edited", () => {
  assert.match(
    renderExample(),
    /Never hand-edit this file/i,
    "a reviewer who edits the view instead of the evidence changes nothing the pipeline reads",
  );
});

test("every claim in the ledger appears somewhere in the review", () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(exampleGenerated, "claims.json"), "utf8"));
  const markdown = renderExample();
  const missing = ledger.claims.filter((claim) => !markdown.includes(claim.id));
  assert.deepEqual(missing.map((c) => c.id), [], "claims missing from the review surface");
});

test("groups claims by what a stranger can actually verify", () => {
  const markdown = renderExample();
  assert.match(markdown, /Can a stranger verify this\?/);
  assert.match(markdown, /attested|self-reported|machine-retrievable/);
});

test("a unit citing an unknown claim is flagged, not silently dropped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labora-profile-"));
  for (const file of ["identity.json", "claims.json", "accomplishments.json"]) {
    fs.copyFileSync(path.join(exampleGenerated, file), path.join(dir, file));
  }
  const bank = JSON.parse(fs.readFileSync(path.join(dir, "accomplishments.json"), "utf8"));
  bank.units[0].claimIds.push("claim-does-not-exist");
  fs.writeFileSync(path.join(dir, "accomplishments.json"), JSON.stringify(bank));

  const markdown = renderProfile("example", dir);
  assert.match(markdown, /claim-does-not-exist.*MISSING FROM LEDGER/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("unit limitations survive into the review", () => {
  const bank = JSON.parse(
    fs.readFileSync(path.join(exampleGenerated, "accomplishments.json"), "utf8"),
  );
  const limitation = bank.units.flatMap((u) => u.evidenceStrength?.limitations || [])[0];
  if (!limitation) return;
  assert.ok(
    renderExample().includes(limitation),
    "limitations are the honest caveats a reviewer most needs; they must not be summarised away",
  );
});
