import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { loadManifest, resolveProvenance, SOURCE_KIND_MEANING, RECHECKABILITY_MEANING } from "../src/lib/evidence-provenance.js";
import { basisIsAdmissible } from "../src/schemas/evidence-manifest.js";

function persona(files, manifestSources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-prov-"));
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  if (manifestSources) {
    const sources = manifestSources.map((entry) => ({
      contentHash: entry.contentHash
        ?? crypto.createHash("sha256").update(files[entry.path]).digest("hex"),
      ...entry,
    }));
    fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "evidence/PROVENANCE.json"),
      JSON.stringify({ schemaVersion: "1.0", persona: "t", sources }, null, 2)
    );
  }
  return root;
}

const REVIEW = {
  path: "evidence/performance-reviews/2026/text/2021-03-review.md",
  sourceKind: "employer_document",
  classificationBasis: "operator_declared",
  recheckability: "point_in_time",
  contentDate: "2021-03",
  capturedAt: "2026-01-14",
};

test("a declared, hash-matching source resolves to its declared kind", () => {
  const root = persona({ [REVIEW.path]: "Exceeded expectations.\n" }, [REVIEW]);
  const resolved = resolveProvenance(path.join(root, REVIEW.path), root, loadManifest(root));
  assert.equal(resolved.state, "declared");
  assert.equal(resolved.sourceKind, "employer_document");
});

// The #9 defect in one test: filing a self-written note under
// `performance-reviews/` must no longer make it employer-attested.
test("a directory named performance-reviews confers nothing", () => {
  const self = "evidence/performance-reviews/2026/text/my-own-notes.md";
  const root = persona({ [self]: "Notes I wrote about my own work.\n" });
  const resolved = resolveProvenance(path.join(root, self), root, loadManifest(root));
  assert.equal(resolved.state, "undeclared");
  assert.equal(resolved.sourceKind, null);
});

// Hash binding proves freshness, not authorship. It must catch the case where a
// classification silently outlives the bytes it described.
test("editing a classified file makes its declaration stale, not silently valid", () => {
  const root = persona({ [REVIEW.path]: "Original text.\n" }, [REVIEW]);
  fs.writeFileSync(path.join(root, REVIEW.path), "Rewritten text.\n");
  const resolved = resolveProvenance(path.join(root, REVIEW.path), root, loadManifest(root));
  assert.equal(resolved.state, "stale");
});

// A tool cannot determine that a human employer wrote a document, and an
// operator's word is not what makes a snapshot machine-retrievable. Rejecting
// the impossible pairings is what prevents accidental laundering.
test("a source kind cannot be paired with a basis that could not produce it", () => {
  assert.equal(basisIsAdmissible("employer_document", "tool_derived"), false);
  assert.equal(basisIsAdmissible("observation_record", "operator_declared"), false);
  assert.equal(basisIsAdmissible("employer_document", "operator_declared"), true);
  assert.equal(basisIsAdmissible("repository_snapshot", "tool_derived"), true);
});

test("an inadmissible pairing is dropped from the manifest with an issue", () => {
  const root = persona(
    { [REVIEW.path]: "text\n" },
    [{ ...REVIEW, classificationBasis: "tool_derived" }]
  );
  const manifest = loadManifest(root);
  assert.equal(manifest.sources.size, 0);
  assert.ok(manifest.issues.some((i) => i.code === "classification_basis_inadmissible"));
});

// labora cannot authenticate authorship. It reports what the operator says.
test("employer authorship is never phrased as verified", () => {
  assert.match(SOURCE_KIND_MEANING.employer_document, /operator identifies/i);
  assert.doesNotMatch(SOURCE_KIND_MEANING.employer_document, /\bverified\b|\battested\b/i);
});

// Most real production work is behind a login or an NDA. If the tool's own
// wording reads as a downgrade, the tool is the thing harming the candidate.
test("operator-gated access is stated as access, not as weakness", () => {
  assert.match(RECHECKABILITY_MEANING.operator_gated, /not a negative signal/i);
  assert.doesNotMatch(RECHECKABILITY_MEANING.operator_gated, /\bweak|\blesser|\bunverified/i);
});

test("structured evidence may leave file-level recheckability unset", () => {
  const obs = "evidence/live/2026-01-01/observations.json";
  const root = persona({ [obs]: "{}\n" }, [{
    path: obs,
    sourceKind: "observation_record",
    classificationBasis: "tool_derived",
    recheckability: null,
    contentDate: "2026-01-01",
    capturedAt: "2026-01-01",
  }]);
  const resolved = resolveProvenance(path.join(root, obs), root, loadManifest(root));
  assert.equal(resolved.state, "declared");
  assert.equal(resolved.recheckability, null,
    "a file holding public and operator-gated findings must not be flattened to one value");
});

test("a malformed manifest reports an issue rather than silently classifying nothing", () => {
  const root = persona({ "evidence/x.md": "x\n" });
  fs.writeFileSync(path.join(root, "evidence/PROVENANCE.json"), "{ not json");
  const manifest = loadManifest(root);
  assert.ok(manifest.issues.some((i) => i.code === "manifest_unparseable"));
});

// The authorization half of #9. Before this, the ONLY way to make a document
// usable was to file it under `performance-reviews/`, which then made the
// renderer call it employer-attested. Evidence is now authorized by being typed
// and hash-bound, so it never has to be misfiled to be usable.
test("declared evidence grounds a claim; the same file undeclared does not", async () => {
  const { validateResumeClaims } = await import("../src/lib/validate-resume-claims.js");
  const body = "Led the migration of the billing service.\n";
  const rel = "evidence/notes/2026-01-01/text/handover.md";
  const hash = crypto.createHash("sha256").update(body).digest("hex");

  const input = (root) => ({
    personaRoot: root,
    workspaceRoot: root,
    identity: { experience: [{ id: "role-1", company: "Acme", title: "Engineer" }] },
    bank: { units: [] },
    resume: { experience: [] },
    ledger: {
      claims: [{
        id: "c-1",
        type: "responsibility",
        fact: "Led the migration of the billing service.",
        sources: [{ path: rel, fileHash: hash, lineStart: 1, lineEnd: 1 }],
      }],
    },
  });

  const declaredRoot = persona({ [rel]: body }, [{
    path: rel,
    sourceKind: "third_party_document",
    classificationBasis: "operator_declared",
    recheckability: "point_in_time",
    contentDate: "2026-01-01",
    capturedAt: "2026-01-01",
  }]);
  const declared = validateResumeClaims(input(declaredRoot));
  assert.ok(
    !declared.issues.some((i) => i.code === "source_not_approved"),
    "declared, hash-bound evidence must be able to ground a claim"
  );

  const bareRoot = persona({ [rel]: body });
  const bare = validateResumeClaims(input(bareRoot));
  assert.ok(
    bare.issues.some((i) => i.code === "source_not_approved"),
    "a file placed under evidence/ without a declaration must not ground a claim"
  );
});
