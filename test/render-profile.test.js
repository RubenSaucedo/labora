import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { renderProfile } from "../src/tools/render-profile.js";
import * as renderModule from "../src/lib/evidence-provenance.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleGenerated = path.join(repoRoot, "data/personas/example/profile/generated");

function renderExample() {
  return renderProfile("example", exampleGenerated, path.join(exampleGenerated, "../.."));
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

test("the review prints each claim disclosure and marks unclassified explicitly", () => {
  const generated = fs.mkdtempSync(path.join(os.tmpdir(), "render-disclosure-"));
  for (const file of ["identity.json", "claims.json", "accomplishments.json"]) {
    fs.copyFileSync(path.join(exampleGenerated, file), path.join(generated, file));
  }
  const ledger = JSON.parse(fs.readFileSync(path.join(generated, "claims.json"), "utf8"));
  delete ledger.claims[0].disclosure;
  fs.writeFileSync(path.join(generated, "claims.json"), JSON.stringify(ledger));

  const markdown = renderProfile("example", generated);
  assert.match(markdown, /disclosure: public/);
  assert.match(markdown, /disclosure: \*\*unclassified\*\*/);
  assert.doesNotMatch(markdown, /\(undefined\)|disclosure:\s*undefined/);
});

test("groups claims by what kind of source backs them", () => {
  const markdown = renderExample();
  assert.match(markdown, /What backs each claim\?/);
  assert.match(markdown, /candidate_statement/);
});

// The #9 defect: a directory named `performance-reviews/` was read as proof an
// employer had written the file, so self-extracted material rendered as
// "an employer wrote it". No path may imply authorship again.
test("no source kind is inferred from a directory name", () => {
  // Comments stripped: this is about what the code does, and the comments
  // deliberately quote the old strings to explain why they are gone.
  const code = fs
    .readFileSync(new URL("../src/tools/render-profile.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /performance-review/,
    "the renderer infers provenance from a path again");
  assert.doesNotMatch(code, /an employer wrote it/,
    "the renderer asserts employer authorship it cannot verify");
});

// labora cannot authenticate who wrote a document. It may report what the
// operator says about it, and must not upgrade that into verification.
test("employer authorship is reported as an operator's identification", () => {
  const { SOURCE_KIND_MEANING } = renderModule;
  assert.match(SOURCE_KIND_MEANING.employer_document, /operator identifies/i);
  assert.doesNotMatch(SOURCE_KIND_MEANING.employer_document, /verified|attested/i);
});

// Restricted access is where most real production work lives. A reviewer who
// reads it as a weak source has been misled by the tool.
test("restricted access is stated as an access property, not a weakness", () => {
  const markdown = renderExample();
  assert.match(markdown, /Restricted access is not a weak source/);
  assert.match(markdown, /not a strength ranking/);
});

test("a claim with several sources is counted once per source kind", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labora-multi-"));
  fs.mkdirSync(path.join(dir, "profile/generated"), { recursive: true });
  for (const file of ["identity.json", "accomplishments.json"]) {
    fs.copyFileSync(path.join(exampleGenerated, file), path.join(dir, "profile/generated", file));
  }
  const ledger = JSON.parse(fs.readFileSync(path.join(exampleGenerated, "claims.json"), "utf8"));
  // Two sources of different kinds on one claim. Reducing this to `sources[0]`
  // silently picks a story about the evidence.
  ledger.claims[0].sources = [
    { ...ledger.claims[0].sources[0], path: "profile/background.md" },
    { ...ledger.claims[0].sources[0], path: "evidence/live/2026-01-01/observations.json" },
  ];
  fs.writeFileSync(path.join(dir, "profile/generated/claims.json"), JSON.stringify(ledger));
  const markdown = renderProfile("multi", path.join(dir, "profile/generated"), dir);
  assert.match(markdown, /observation_record/);
  assert.match(markdown, /candidate_statement/);
});

// Metadata debt must never be reported as an evidence problem.
test("undeclared provenance is reported separately from claim grounding", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labora-undeclared-"));
  fs.mkdirSync(path.join(dir, "profile/generated"), { recursive: true });
  for (const file of ["identity.json", "accomplishments.json"]) {
    fs.copyFileSync(path.join(exampleGenerated, file), path.join(dir, "profile/generated", file));
  }
  const ledger = JSON.parse(fs.readFileSync(path.join(exampleGenerated, "claims.json"), "utf8"));
  for (const claim of ledger.claims) {
    claim.sources = [{ ...claim.sources[0], path: "evidence/notes/2026-01-01/text/notes.md" }];
  }
  fs.writeFileSync(path.join(dir, "profile/generated/claims.json"), JSON.stringify(ledger));
  const markdown = renderProfile("undeclared", path.join(dir, "profile/generated"), dir);
  assert.match(markdown, /Provenance metadata/);
  assert.match(markdown, /Claim grounding is validated separately/);
  assert.match(markdown, /evidence\/PROVENANCE\.json/);
  assert.match(markdown, /notes\.md` — 10 claim references/);
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

// The review surface exists so ungrounded prose can be caught by a human. It
// used to render a project's name and link only, so a description that no claim
// supported was invisible to review as well as unchecked by the gate.
test("a project description renders beside the claims that ground it", () => {
  const identity = JSON.parse(fs.readFileSync(path.join(exampleGenerated, "identity.json"), "utf8"));
  const generated = fs.mkdtempSync(path.join(os.tmpdir(), "render-prose-"));
  for (const file of ["claims.json", "accomplishments.json"]) {
    fs.copyFileSync(path.join(exampleGenerated, file), path.join(generated, file));
  }
  identity.projects = [{
    name: "Labora",
    description: "An evidence-grounded resume assurance system.",
    highlights: ["Every rendered bullet maps to a verified claim."],
    link: "",
    claimIds: ["some-claim"],
  }];
  fs.writeFileSync(path.join(generated, "identity.json"), JSON.stringify(identity));

  const markdown = renderProfile("example", generated);
  assert.match(markdown, /An evidence-grounded resume assurance system\./,
    "a description that reaches a resume must be visible to a reviewer");
  assert.match(markdown, /Every rendered bullet maps to a verified claim\./,
    "highlights render too");
  assert.match(markdown, /grounded by:.*some-claim/,
    "a reviewer must see which claims the prose came from");
});

test("prose with no claim provenance is called out in the review", () => {
  const identity = JSON.parse(fs.readFileSync(path.join(exampleGenerated, "identity.json"), "utf8"));
  const generated = fs.mkdtempSync(path.join(os.tmpdir(), "render-prose-bare-"));
  for (const file of ["claims.json", "accomplishments.json"]) {
    fs.copyFileSync(path.join(exampleGenerated, file), path.join(generated, file));
  }
  identity.projects = [{
    name: "Labora",
    description: "Led a team of twelve.",
    highlights: [],
    link: "",
    claimIds: [],
  }];
  fs.writeFileSync(path.join(generated, "identity.json"), JSON.stringify(identity));

  assert.match(renderProfile("example", generated), /grounded by:.*\*\*nothing\*\*/,
    "ungrounded prose must be conspicuous, not merely absent");
});
