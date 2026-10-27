import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyDefaultResume, selectDefaultResume } from "../src/lib/default-resume.js";
import { sha256 } from "../src/lib/persona-files.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-baseline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
    return sha256(fs.readFileSync(file));
  };
  const source = { path: "applications/original-build/resume.json", sha256: write("applications/original-build/resume.json", { summary: "Synthetic fixture" }) };
  const artifact = { path: "profile/resume/resume.md", sha256: write("profile/resume/resume.md", "# Synthetic resume\n") };
  const approval = {
    schemaVersion: "1.0", artifact, source, approvedAt: "2026-10-01T10:00:00Z",
    reference: "operator-confirmation-a", acceptedFindings: ["An accepted synthetic finding"],
  };
  const approvalRef = { path: "profile/resume/approval.json", sha256: write("profile/resume/approval.json", approval) };
  const descriptor = { schemaVersion: "1.0", artifact, approval: approvalRef,
    relocations: "profile/resume/relocations.json" };
  write("profile/resume/current.json", descriptor);
  write("profile/resume/relocations.json", { schemaVersion: "1.0", relocations: [] });
  write("application-workspace.json", {
    schemaVersion: "1.0", layout: "shared-current-state", indexFormat: "labora-application-index-v1",
    instructions: "applications/README.md", index: "applications/index.json", briefs: "applications/briefs",
    forms: "applications/forms", answers: "applications/answers", plans: "applications/plans",
    dashboard: "applications/dashboard.md", defaultResume: "profile/resume/current.json",
  });
  write("applications/README.md", "# Operator-owned preparation instructions\n");
  write("applications/index.json", {
    schemaVersion: "1.0", openings: ["opening-a", "opening-b"].map((openingId) => ({
      openingId, title: "Synthetic opening", url: `https://example.invalid/${openingId}`,
      identity: { authority: "example.invalid", requisition: openingId },
      source: { path: "archive/observation.json", observedAt: "2026-10-01T10:00:00Z", sha256: "a".repeat(64), postingHash: "b".repeat(64) },
      verification: { status: "historical" }, formCapture: { status: "not_captured" },
      answerReview: { status: "not_reviewed" }, submission: { status: "unknown" },
      brief: `applications/briefs/${openingId}.md`,
    })),
  });
  return { root, write, source, artifact, approval, descriptor };
}

test("multiple openings reference the same approved bytes without copies, edits or new builds", (t) => {
  const { root, artifact } = fixture(t);
  const before = fs.readFileSync(path.join(root, "profile/resume/approval.json"));
  const first = selectDefaultResume(root, "opening-a", { apply: true });
  const second = selectDefaultResume(root, "opening-b", { apply: true });
  assert.deepEqual(first.entry.resume, second.entry.resume);
  assert.equal(first.entry.resume.artifact.path, artifact.path);
  assert.equal(sha256(fs.readFileSync(path.join(root, artifact.path))), artifact.sha256);
  assert.deepEqual(fs.readFileSync(path.join(root, "profile/resume/approval.json")), before);
  assert.equal(fs.existsSync(path.join(root, "applications/opening-a/resume.pdf")), false);
  assert.deepEqual(fs.readdirSync(path.join(root, "applications")).sort(),
    ["README.md", "briefs", "dashboard.md", "index.json", "original-build"]);
});

test("changed artifact or approval bytes cannot inherit an old approval", (t) => {
  const { root, write } = fixture(t);
  write("profile/resume/resume.md", "# Changed draft\n");
  assert.throws(() => verifyDefaultResume(root), /artifact hash mismatch/i);
  assert.equal(fs.existsSync(path.join(root, "applications/briefs")), false);
  write("profile/resume/resume.md", "# Synthetic resume\n");
  write("profile/resume/approval.json", { reference: "different" });
  assert.throws(() => verifyDefaultResume(root), /approval hash mismatch/i);
});

test("a filename alone is not approval and a changed declared hash needs a new exact approval", (t) => {
  const { root, write, descriptor } = fixture(t);
  const modified = write("profile/resume/resume.md", "# New exact bytes\n");
  write("profile/resume/current.json", { ...descriptor, artifact: { ...descriptor.artifact, sha256: modified } });
  assert.throws(() => verifyDefaultResume(root), /does not approve/i);
  write("profile/resume/current.json", { schemaVersion: "1.0", artifact: descriptor.artifact });
  assert.throws(() => verifyDefaultResume(root), /approval/i);
});

test("explicit relocation preserves immutable approval, source hash and accepted findings", (t) => {
  const { root, write, source, approval } = fixture(t);
  const snapshot = fs.readFileSync(path.join(root, "profile/resume/approval.json"));
  const archived = "archive/applications/original-build/resume.json";
  write(archived, fs.readFileSync(path.join(root, source.path), "utf8"));
  fs.unlinkSync(path.join(root, source.path));
  write("profile/resume/relocations.json", { schemaVersion: "1.0",
    relocations: [{ from: source.path, to: archived, sha256: source.sha256 }] });
  const selected = verifyDefaultResume(root);
  assert.equal(selected.source.path, archived);
  assert.equal(selected.source.originalPath, source.path);
  assert.equal(selected.source.sha256, source.sha256);
  assert.deepEqual(selected.acceptedFindings, approval.acceptedFindings);
  assert.deepEqual(fs.readFileSync(path.join(root, "profile/resume/approval.json")), snapshot);
  assert.equal(fs.existsSync(path.join(root, source.path)), false);
});

test("undeclared, ambiguous or hash-mismatched relocations produce a finding, never a fallback", (t) => {
  const { root, write, source } = fixture(t);
  const archived = "archive/applications/original-build/resume.json";
  write(archived, fs.readFileSync(path.join(root, source.path), "utf8"));
  fs.unlinkSync(path.join(root, source.path));
  assert.throws(() => verifyDefaultResume(root), /relocation/i);
  const relocation = { from: source.path, to: archived, sha256: "0".repeat(64) };
  write("profile/resume/relocations.json", { schemaVersion: "1.0", relocations: [relocation] });
  assert.throws(() => verifyDefaultResume(root), /relocation hash mismatch/i);
  write("profile/resume/relocations.json", { schemaVersion: "1.0",
    relocations: [{ ...relocation, sha256: source.sha256 }, { ...relocation, sha256: source.sha256 }] });
  assert.throws(() => verifyDefaultResume(root), /ambiguous/i);
  write("profile/resume/relocations.json", { schemaVersion: "1.0",
    relocations: [{ ...relocation, sha256: source.sha256 }] });
  write(archived, { summary: "Changed input" });
  assert.throws(() => verifyDefaultResume(root), /source hash mismatch/i);
});

test("reuse is read-only unless explicitly selected and does not invent a default", (t) => {
  const { root, write } = fixture(t);
  const index = fs.readFileSync(path.join(root, "applications/index.json"));
  selectDefaultResume(root, "opening-a");
  assert.deepEqual(fs.readFileSync(path.join(root, "applications/index.json")), index);
  const contract = JSON.parse(fs.readFileSync(path.join(root, "application-workspace.json")));
  delete contract.defaultResume;
  write("application-workspace.json", contract);
  assert.throws(() => verifyDefaultResume(root), /designate/i);
  assert.equal(verifyDefaultResume(root, { descriptor: "profile/resume/current.json" }).artifact.path,
    "profile/resume/resume.md");
});
