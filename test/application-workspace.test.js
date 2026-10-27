import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readApplicationWorkspace, resolveObservation, trackOpening } from "../src/lib/application-workspace.js";
import { personaPath, sha256 } from "../src/lib/persona-files.js";
import { lintPersonaLayout } from "../src/lib/lint-workspace.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-handoff-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  };
  const contract = {
    schemaVersion: "1.0", layout: "shared-current-state", indexFormat: "labora-application-index-v1",
    instructions: "applications/README.md", index: "applications/index.json",
    briefs: "applications/briefs", forms: "applications/forms", answers: "applications/answers",
    plans: "applications/plans", dashboard: "applications/dashboard.md",
  };
  write("application-workspace.json", contract);
  write(contract.instructions, "# Operator instructions\nKeep research and archive intact.\n");
  write("profile/contact.md", "# Synthetic example\n");
  const job = {
    jobId: "discovery-a", title: "Example opening", company: "Example",
    url: "https://example.invalid/openings/a", observedAt: "2026-10-01T10:00:00Z",
    postingHash: sha256("Example posting"), status: "open",
  };
  const observation = "job-search/run-a/candidates.json";
  write(observation, { persona: "example", candidates: [job] });
  const selection = {
    openingId: "opening-a", identity: { authority: "example.invalid", requisition: "a" },
    source: { path: observation, sha256: sha256(fs.readFileSync(path.join(root, observation))),
      jobId: job.jobId, observedAt: job.observedAt, postingHash: job.postingHash },
  };
  return { root, write, selection, contract, job };
}

test("inspection, lint and session announcement do not mutate a shared workspace", (t) => {
  const { root, contract } = fixture(t);
  const before = fs.readFileSync(path.join(root, "application-workspace.json"));
  const inspected = readApplicationWorkspace(root);
  assert.match(inspected.instructions, /Operator instructions/);
  assert.equal(inspected.contract.index, contract.index);
  lintPersonaLayout(root);
  const announced = spawnSync(process.execPath, ["bin/labora", "announce"], {
    cwd: process.cwd(), env: { ...process.env, LABORA_WORKSPACE: root }, encoding: "utf8",
  });
  assert.equal(announced.status, 0, announced.stderr);
  assert.deepEqual(fs.readFileSync(path.join(root, "application-workspace.json")), before);
  assert.equal(fs.existsSync(path.join(root, contract.index)), false);
  assert.equal(fs.existsSync(path.join(root, contract.dashboard)), false);
});

test("tracking is a dry run unless applied and refreshes one current record and brief", (t) => {
  const { root, selection, contract } = fixture(t);
  const draft = trackOpening(root, selection);
  assert.equal(draft.entry.submission.status, "unknown");
  assert.equal(draft.entry.verification.status, "historical");
  assert.equal(fs.existsSync(path.join(root, contract.index)), false);
  trackOpening(root, selection, { apply: true });
  const first = fs.readFileSync(path.join(root, contract.index));
  trackOpening(root, selection, { apply: true });
  assert.deepEqual(fs.readFileSync(path.join(root, contract.index)), first);
  const index = JSON.parse(first);
  assert.equal(index.openings.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(root, contract.briefs)), ["opening-a.md"]);
  assert.match(fs.readFileSync(path.join(root, contract.dashboard), "utf8"), /historical.*unknown/);
});

test("distinct requisitions stay distinct and title-only or colliding identities need clarification", (t) => {
  const { root, selection, contract } = fixture(t);
  trackOpening(root, selection, { apply: true });
  trackOpening(root, { ...selection, openingId: "opening-b",
    identity: { ...selection.identity, requisition: "b" } }, { apply: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, contract.index))).openings.length, 2);
  assert.throws(() => trackOpening(root, { ...selection, identity: { title: "Example opening" } }), /stable|identity/i);
  assert.throws(() => trackOpening(root, { ...selection,
    identity: { ...selection.identity, requisition: "c" } }), /different identity/);
});

test("explicit archive references retain hashes and observation dates without claiming freshness", (t) => {
  const { root, selection, write } = fixture(t);
  const old = path.join(root, selection.source.path);
  const archived = "archive/job-search/run-a/candidates.json";
  write(archived, fs.readFileSync(old, "utf8"));
  fs.unlinkSync(old);
  assert.throws(() => resolveObservation(root, selection.source), /dangling/i);
  const source = { ...selection.source, path: archived };
  const observed = resolveObservation(root, source);
  assert.equal(observed.observedAt, selection.source.observedAt);
  const result = trackOpening(root, { ...selection, source }, { apply: true });
  assert.equal(result.entry.source.sha256, selection.source.sha256);
  assert.equal(result.entry.verification.status, "historical");
});

test("hash mismatches, missing candidates and cross-persona paths are actionable errors", (t) => {
  const { root, selection } = fixture(t);
  assert.throws(() => resolveObservation(root, { ...selection.source, sha256: "0".repeat(64) }), /hash mismatch/i);
  assert.throws(() => resolveObservation(root, { ...selection.source, jobId: "missing" }), /exactly one/i);
  assert.throws(() => personaPath(root, "../other/candidates.json"), /leaves this persona/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "labora-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(root, "external"));
  assert.throws(() => personaPath(root, "external/new.json"), /outside this persona/);
});

test("unrecognized indexes and authored output files are never silently converted or overwritten", (t) => {
  const { root, selection, write, contract } = fixture(t);
  write(contract.index, { customQueue: ["keep"] });
  assert.throws(() => trackOpening(root, selection, { apply: true }), /index format/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, contract.index))), { customQueue: ["keep"] });
  fs.unlinkSync(path.join(root, contract.index));
  write(`${contract.briefs}/opening-a.md`, "Operator-authored brief\n");
  assert.throws(() => trackOpening(root, selection, { apply: true }), /operator-owned/i);
  assert.equal(fs.existsSync(path.join(root, contract.index)), false);
});

test("refresh preserves independent states, operator metadata and unrelated directories", (t) => {
  const { root, selection, write, contract } = fixture(t);
  trackOpening(root, selection, { apply: true });
  const index = JSON.parse(fs.readFileSync(path.join(root, contract.index)));
  index.notes = "Keep this";
  Object.assign(index.openings[0], {
    submission: { status: "submitted", operatorReference: "local-note" },
    answerReview: { status: "reviewed" }, formCapture: { status: "captured" }, custom: "retained",
  });
  write(contract.index, index);
  for (const dir of ["research/market", "archive/applications", "applications/tools", contract.answers]) {
    write(`${dir}/keep.md`, "Operator-owned\n");
  }
  const result = trackOpening(root, { ...selection, submission: { status: "unknown" } }, { apply: true });
  assert.equal(result.entry.submission.status, "submitted");
  assert.equal(result.entry.answerReview.status, "reviewed");
  assert.equal(result.entry.formCapture.status, "captured");
  assert.equal(result.entry.custom, "retained");
  assert.equal(result.index.notes, "Keep this");
  assert.equal(fs.readFileSync(path.join(root, "research/market/keep.md"), "utf8"), "Operator-owned\n");
});

test("native packages require no shared descriptor", (t) => {
  const { root, write } = fixture(t);
  fs.unlinkSync(path.join(root, "application-workspace.json"));
  write("applications/native/job.md", "# Example posting\n");
  assert.equal(readApplicationWorkspace(root).layout, "native");
  assert.equal(fs.readFileSync(path.join(root, "applications/native/job.md"), "utf8"), "# Example posting\n");
});
