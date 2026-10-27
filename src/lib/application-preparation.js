import fs from "node:fs";
import path from "node:path";
import { readApplicationWorkspace, readApplicationIndex, updateOpening } from "./application-workspace.js";
import { verifyDefaultResume } from "./default-resume.js";
import { personaPath, readJson, sha256 } from "./persona-files.js";
import { formFingerprint } from "./application-form.js";
import { planApplication, planReviewMarkdown } from "./application-plan.js";

export function preparationOpening(root, openingId) {
  const workspace = readApplicationWorkspace(root);
  const matches = readApplicationIndex(workspace).openings.filter((entry) => entry.openingId === openingId);
  if (matches.length !== 1) throw new Error("Name exactly one existing shared-workspace opening; no package was scaffolded.");
  return { workspace, entry: matches[0] };
}

function serialized(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeProducedJson(root, relative, payload, producer) {
  const file = personaPath(root, relative);
  if (fs.existsSync(file) && readJson(file).producer !== producer) {
    throw new Error("The declared output is operator-owned; choose an unused output path instead of overwriting it.");
  }
  const bytes = serialized(payload);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return { path: relative, sha256: sha256(bytes) };
}

export function saveCapturedForm(root, openingId, form, { apply = false } = {}) {
  const { workspace } = preparationOpening(root, openingId);
  if (!form.questions?.length || form.snapshotHash !== formFingerprint(form)) {
    throw new Error("Cannot save an empty or changed form capture; obtain a fresh observation.");
  }
  const producer = "labora-application-observation";
  const captured = { ...form, producer, openingId };
  const relative = `${workspace.contract.forms}/${openingId}.form.json`;
  if (!apply) return { applied: false, form: captured, path: relative };
  const reference = writeProducedJson(root, relative, captured, producer);
  const result = updateOpening(root, openingId, (entry) => ({
    ...entry,
    formCapture: { status: "captured", ...reference, snapshotHash: form.snapshotHash,
      capturedAt: form.capturedAt, url: form.url },
    answerReview: { ...entry.answerReview, status: "needs_review" },
  }), { apply: true });
  return { ...result, form: captured };
}

function readReference(root, reference, label) {
  if (!reference?.path || !reference.sha256) throw new Error(`The ${label} has no exact saved reference; prepare it explicitly.`);
  const bytes = fs.readFileSync(personaPath(root, reference.path));
  if (sha256(bytes) !== reference.sha256) {
    throw new Error(`The ${label} changed since review; prepare a new plan before entry.`);
  }
  return JSON.parse(bytes);
}

export function capturedForm(root, openingId, entry) {
  const form = readReference(root, entry.formCapture, "captured form");
  if (form.openingId !== openingId || form.snapshotHash !== entry.formCapture.snapshotHash ||
      form.snapshotHash !== formFingerprint(form) || form.url !== entry.formCapture.url) {
    throw new Error("The form does not match this named opening and observation; re-scan explicitly.");
  }
  return form;
}

export function verifyResumeSelection(root, selected) {
  const fresh = verifyDefaultResume(root, { descriptor: selected?.descriptor?.path });
  if (selected && (fresh.descriptor.sha256 !== selected.descriptor.sha256 ||
      fresh.artifact.sha256 !== selected.artifact.sha256 ||
      fresh.artifact.path !== selected.artifact.path ||
      fresh.approval.sha256 !== selected.approval.sha256 ||
      fresh.approval.path !== selected.approval.path ||
      fresh.source.originalPath !== selected.source.originalPath ||
      fresh.source.sha256 !== selected.source.sha256)) {
    throw new Error("The selected resume reference changed; resolve its exact approval and prepare a new plan. No substitute was selected.");
  }
  return fresh;
}

export function prepareApplication(root, openingId, answerBankPath, { apply = false } = {}) {
  const { workspace, entry } = preparationOpening(root, openingId);
  const form = capturedForm(root, openingId, entry);
  const answerBytes = fs.readFileSync(personaPath(root, answerBankPath));
  const bank = JSON.parse(answerBytes);
  let resume = null;
  let resumeFinding = null;
  try {
    resume = verifyResumeSelection(root, entry.resume);
  } catch (error) {
    resumeFinding = error.message;
  }
  const plan = planApplication(form, bank, { openingId, country: entry.country, resume, resumeFinding });
  const producer = "labora-application-plan";
  const payload = {
    schemaVersion: "1.0", producer, openingId,
    form: { path: entry.formCapture.path, sha256: entry.formCapture.sha256 },
    answerBank: { path: answerBankPath, sha256: sha256(answerBytes) },
    plan, reviewMarkdown: planReviewMarkdown(plan),
  };
  const relative = `${workspace.contract.plans}/${openingId}.plan.json`;
  if (!apply) return { applied: false, ...payload, path: relative };
  const reference = writeProducedJson(root, relative, payload, producer);
  const updated = updateOpening(root, openingId, (current) => ({
    ...current, ...(resume ? { resume } : {}),
    answerReview: { status: "planned", plan: reference, readyForEntry: plan.readyForEntry },
  }), { apply: true });
  return { ...updated, ...payload };
}

function comparablePlan(plan) {
  const comparable = structuredClone(plan);
  if (comparable.resume) comparable.resume.source.path = comparable.resume.source.originalPath;
  return JSON.stringify(comparable);
}

export function prefillInputs(root, openingId) {
  const { entry } = preparationOpening(root, openingId);
  const saved = readReference(root, entry.answerReview?.plan, "review plan");
  if (saved.openingId !== openingId || saved.plan.openingId !== openingId) {
    throw new Error("The plan belongs to a different opening; prepare the named opening explicitly.");
  }
  const form = capturedForm(root, openingId, entry);
  if (saved.form.path !== entry.formCapture.path || saved.form.sha256 !== entry.formCapture.sha256) {
    throw new Error("The observation changed after planning; review a fresh plan.");
  }
  const bank = readReference(root, saved.answerBank, "answer bank");
  if (Boolean(saved.plan.resume) !== Boolean(entry.resume)) {
    throw new Error("The selected resume changed after planning; review a fresh plan before entry.");
  }
  const resume = saved.plan.resume ? verifyResumeSelection(root, entry.resume) : null;
  const fresh = planApplication(form, bank, {
    openingId, country: entry.country, resume, resumeFinding: saved.plan.resumeFinding,
  });
  if (comparablePlan(fresh) !== comparablePlan(saved.plan)) {
    throw new Error("The entry mapping differs from the reviewed plan; prepare and review the exact current answers.");
  }
  if (!fresh.readyForEntry) {
    throw new Error("Required answers remain unresolved; read the brief and confirm the exact answers or scoped manual steps before entry.");
  }
  const resumeBytes = resume ? fs.readFileSync(personaPath(root, resume.artifact.path)) : null;
  if (resumeBytes && sha256(resumeBytes) !== resume.artifact.sha256) {
    throw new Error("The resume changed immediately before attachment; resolve the hash mismatch.");
  }
  return { form, plan: fresh, resumeBytes };
}
