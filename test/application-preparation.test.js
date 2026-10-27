import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { saveCapturedForm, prepareApplication, prefillInputs } from "../src/lib/application-preparation.js";
import { formFingerprint } from "../src/lib/application-form.js";
import { valueSha256 } from "../src/lib/application-plan.js";
import { requiredDependencies } from "../src/lib/tool-dependencies.js";
import { sha256 } from "../src/lib/persona-files.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-prepare-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, payload) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof payload === "string" ? payload : `${JSON.stringify(payload)}\n`);
  };
  write("application-workspace.json", {
    schemaVersion: "1.0", layout: "shared-current-state", indexFormat: "labora-application-index-v1",
    instructions: "applications/README.md", index: "applications/index.json",
    briefs: "applications/briefs", forms: "applications/forms", answers: "applications/answers",
    plans: "applications/plans", dashboard: "applications/dashboard.md",
  });
  write("applications/README.md", "# Operator-owned preparation instructions\n");
  write("applications/index.json", {
    schemaVersion: "1.0", openings: [{
      openingId: "opening-a", country: "US", title: "Synthetic opening", url: "https://example.invalid/opening-a",
      brief: "applications/briefs/opening-a.md", source: { path: "archive/observation.json",
        observedAt: "2026-10-01T10:00:00Z", sha256: "a".repeat(64), postingHash: "b".repeat(64) },
      verification: { status: "historical" }, formCapture: { status: "not_captured" },
      answerReview: { status: "not_reviewed" }, submission: { status: "unknown" },
    }],
  });
  const form = {
    schemaVersion: "1.0", url: "https://example.invalid/opening-a/form", capturedAt: "2026-10-01T10:00:00Z",
    questions: [{ id: "q-name", label: "Preferred name", type: "text", selector: "#name", required: true }],
    submitControls: [{ selector: "#submit", type: "submit", label: "Apply" }], limitations: [],
  };
  form.snapshotHash = formFingerprint(form);
  const answer = { kind: "fact", value: "Synthetic Example",
    confirmation: { reference: "operator-a", at: "2026-10-01T10:00:00Z", valueSha256: valueSha256("Synthetic Example") } };
  const bank = { schemaVersion: "1.0", answers: { name: answer }, bindings: { "q-name": { answer: "name" } } };
  const bankPath = "applications/answers/answer-bank.json";
  write(bankPath, bank);
  return { root, write, form, bank, bankPath };
}

test("capture and offline planning update one shared record and brief without a browser or resume build", (t) => {
  const { root, form, bankPath } = fixture(t);
  saveCapturedForm(root, "opening-a", form, { apply: true });
  const prepared = prepareApplication(root, "opening-a", bankPath, { apply: true });
  assert.equal(prepared.plan.readyForEntry, true);
  assert.equal(prepared.entry.submission.status, "unknown");
  assert.equal(prefillInputs(root, "opening-a").plan.decisions[0].value, "Synthetic Example");
  assert.match(fs.readFileSync(path.join(root, "applications/briefs/opening-a.md"), "utf8"), /Exact proposed value/);
  assert.deepEqual(fs.readdirSync(path.join(root, "applications/forms")), ["opening-a.form.json"]);
  assert.equal(fs.existsSync(path.join(root, "applications/opening-a")), false);
  const output = spawnSync(process.execPath, ["bin/labora", "application", "plan", root, "opening-a", bankPath], {
    cwd: process.cwd(), env: { ...process.env, LABORA_CHROME: "/not-a-browser" }, encoding: "utf8",
  });
  assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(requiredDependencies(path.resolve("src/tools/application/plan.js"), ["puppeteer-core"]), []);
});

test("dry runs leave operational files unchanged and captured observations never record submission", (t) => {
  const { root, form, bankPath } = fixture(t);
  saveCapturedForm(root, "opening-a", form);
  assert.equal(fs.existsSync(path.join(root, "applications/forms")), false);
  saveCapturedForm(root, "opening-a", form, { apply: true });
  const before = fs.readFileSync(path.join(root, "applications/index.json"));
  prepareApplication(root, "opening-a", bankPath);
  assert.deepEqual(fs.readFileSync(path.join(root, "applications/index.json")), before);
  assert.equal(fs.existsSync(path.join(root, "applications/plans")), false);
});

test("changed banks, captures and plan bytes invalidate entry before any browser is opened", (t) => {
  const { root, form, bank, bankPath, write } = fixture(t);
  saveCapturedForm(root, "opening-a", form, { apply: true });
  prepareApplication(root, "opening-a", bankPath, { apply: true });
  write(bankPath, { ...bank, answers: { name: { ...bank.answers.name, value: "Changed after review" } } });
  assert.throws(() => prefillInputs(root, "opening-a"), /answer bank.*changed/i);
  write(bankPath, bank);
  write("applications/forms/opening-a.form.json", {
    ...form, producer: "labora-application-observation", openingId: "opening-a", questions: [],
  });
  assert.throws(() => prefillInputs(root, "opening-a"), /captured form.*changed/i);
  saveCapturedForm(root, "opening-a", form, { apply: true });
  prepareApplication(root, "opening-a", bankPath, { apply: true });
  write("applications/plans/opening-a.plan.json", { openingId: "opening-b", plan: {} });
  assert.throws(() => prefillInputs(root, "opening-a"), /review plan.*changed/i);
});

test("unknown required legal answers leave a useful plan and do not permit live entry", (t) => {
  const { root, form, bankPath } = fixture(t);
  form.questions[0].label = "Are you legally authorized to work in Canada?";
  form.snapshotHash = formFingerprint(form);
  saveCapturedForm(root, "opening-a", form, { apply: true });
  const prepared = prepareApplication(root, "opening-a", bankPath, { apply: true });
  assert.equal(prepared.plan.decisions[0].status, "blocked");
  assert.equal(prepared.plan.readyForEntry, false);
  assert.throws(() => prefillInputs(root, "opening-a"), /Required answers remain unresolved/);
});

test("operator-owned captures are not overwritten and live entry requires a separate named request", (t) => {
  const { root, form, write } = fixture(t);
  write("applications/forms/opening-a.form.json", { notes: "Operator-owned" });
  assert.throws(() => saveCapturedForm(root, "opening-a", form, { apply: true }), /operator-owned/);
  const output = spawnSync(process.execPath, ["bin/labora", "application", "fill", root, "opening-a"], {
    cwd: process.cwd(), env: { ...process.env, LABORA_CHROME: "/not-a-browser" }, encoding: "utf8",
  });
  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /--live/);
  assert.doesNotMatch(output.stderr, /Chrome|browser was found/);
});

test("entry re-verifies exact approved bytes and honors source relocation without changing approval", (t) => {
  const { root, form, bankPath, write } = fixture(t);
  const sourcePath = "applications/original-build/resume.json";
  write(sourcePath, { summary: "Synthetic fixture" });
  write("profile/resume/resume.md", "# Synthetic resume\n");
  const artifact = { path: "profile/resume/resume.md",
    sha256: sha256(fs.readFileSync(path.join(root, "profile/resume/resume.md"))) };
  const sourceHash = sha256(fs.readFileSync(path.join(root, sourcePath)));
  write("profile/resume/approval.json", {
    schemaVersion: "1.0", artifact, source: { path: sourcePath, sha256: sourceHash },
    approvedAt: "2026-10-01T10:00:00Z", reference: "operator-a", acceptedFindings: ["Accepted synthetic note"],
  });
  const approvalBytes = fs.readFileSync(path.join(root, "profile/resume/approval.json"));
  write("profile/resume/current.json", {
    schemaVersion: "1.0", artifact,
    approval: { path: "profile/resume/approval.json", sha256: sha256(approvalBytes) },
    relocations: "profile/resume/relocations.json",
  });
  write("profile/resume/relocations.json", { schemaVersion: "1.0", relocations: [] });
  const contract = JSON.parse(fs.readFileSync(path.join(root, "application-workspace.json")));
  write("application-workspace.json", { ...contract, defaultResume: "profile/resume/current.json" });
  form.questions.push({ id: "q-resume", label: "Resume", type: "file", attachment: "resume",
    selector: "#resume", required: true });
  form.snapshotHash = formFingerprint(form);
  saveCapturedForm(root, "opening-a", form, { apply: true });
  prepareApplication(root, "opening-a", bankPath, { apply: true });
  assert.equal(sha256(prefillInputs(root, "opening-a").resumeBytes), artifact.sha256);
  const archived = "archive/applications/original-build/resume.json";
  write(archived, fs.readFileSync(path.join(root, sourcePath), "utf8"));
  fs.unlinkSync(path.join(root, sourcePath));
  write("profile/resume/relocations.json", { schemaVersion: "1.0",
    relocations: [{ from: sourcePath, to: archived, sha256: sourceHash }] });
  const moved = prefillInputs(root, "opening-a");
  assert.equal(moved.plan.resume.source.path, archived);
  assert.deepEqual(moved.plan.resume.acceptedFindings, ["Accepted synthetic note"]);
  assert.deepEqual(fs.readFileSync(path.join(root, "profile/resume/approval.json")), approvalBytes);
  write(artifact.path, "# Changed after review\n");
  assert.throws(() => prefillInputs(root, "opening-a"), /artifact hash mismatch/i);
});

test("entry uses the same answer mapping even if a generated plan is edited with a new envelope hash", (t) => {
  const { root, form, bankPath, write } = fixture(t);
  saveCapturedForm(root, "opening-a", form, { apply: true });
  prepareApplication(root, "opening-a", bankPath, { apply: true });
  const planPath = "applications/plans/opening-a.plan.json";
  const saved = JSON.parse(fs.readFileSync(path.join(root, planPath)));
  saved.plan.decisions[0].value = "Not what the bank confirmed";
  write(planPath, saved);
  const index = JSON.parse(fs.readFileSync(path.join(root, "applications/index.json")));
  index.openings[0].answerReview.plan.sha256 = sha256(fs.readFileSync(path.join(root, planPath)));
  write("applications/index.json", index);
  assert.throws(() => prefillInputs(root, "opening-a"), /mapping differs from the reviewed plan/);
});
