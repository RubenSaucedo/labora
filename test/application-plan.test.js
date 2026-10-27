import test from "node:test";
import assert from "node:assert/strict";
import { planApplication, valueSha256 } from "../src/lib/application-plan.js";
import { formFingerprint } from "../src/lib/application-form.js";

const at = "2026-10-01T10:00:00Z";
function form(questions) {
  const result = { schemaVersion: "1.0", url: "https://example.invalid/form",
    questions: questions.map((question) => ({ id: "q", label: "Example", type: "text",
      selector: "#example", required: true, ...question })), submitControls: [] };
  result.snapshotHash = formFingerprint(result);
  return result;
}
function bank(answer, binding = {}) {
  return { schemaVersion: "1.0", answers: { example: answer },
    bindings: { q: { answer: "example", ...binding } } };
}
function confirmed(answer) {
  return { ...answer, confirmation: { reference: "operator-a", at, valueSha256: valueSha256(answer.value) } };
}
function approved(answer) {
  return { ...answer, approval: { reference: "operator-a", at, openingId: "opening-a",
    questionId: "q", valueSha256: valueSha256(answer.value) } };
}
const context = { openingId: "opening-a", country: "US" };

test("exact-text drafts and essays remain skipped until approved, and edits invalidate approval", () => {
  for (const kind of ["draft", "essay"]) {
    const captured = form([{ label: "Why this opening?", type: "textarea" }]);
    const draft = { kind, value: "A synthetic proposal." };
    assert.equal(planApplication(captured, bank(draft), context).decisions[0].canFill, false);
    assert.equal(planApplication(captured, bank({ ...draft, approval: { reference: "field-approved" } }), context).readyForEntry, false);
    const signed = approved(draft);
    assert.equal(planApplication(captured, bank(signed), context).decisions[0].canFill, true);
    assert.equal(planApplication(captured, bank({ ...signed, value: "Changed proposal" }), context).readyForEntry, false);
    assert.equal(planApplication(captured, bank(signed), { ...context, openingId: "opening-b" }).readyForEntry, false);
  }
});

test("legal answers are exact country-and-intent-specific, including positive without-sponsorship questions", () => {
  const authorization = confirmed({ kind: "legal", intent: "work_authorization", country: "US", value: "Yes" });
  const legal = form([{ label: "Are you legally authorized to work in the United States?" }]);
  assert.equal(planApplication(legal, bank(authorization), context).decisions[0].canFill, true);
  const canada = form([{ label: "Are you legally authorized to work in Canada?" }]);
  assert.equal(planApplication(canada, bank(authorization), context).decisions[0].status, "blocked");
  const without = form([{ label: "Are you authorized to work without employer sponsorship?" }]);
  const sponsor = confirmed({ kind: "legal", intent: "sponsorship_needed", country: "US", value: "No" });
  assert.equal(planApplication(without, bank(sponsor), context).readyForEntry, false);
  const correct = confirmed({ kind: "legal", intent: "authorization_without_sponsorship", country: "US", value: "Yes" });
  assert.equal(planApplication(without, bank(correct), context).readyForEntry, true);
  for (const label of ["Citizenship", "Visa type", "Are you authorized to work in Canada or the United States?"]) {
    assert.equal(planApplication(form([{ label }]), bank(authorization), context).decisions[0].status, "blocked");
  }
});

test("legal null is not no, and residence or history never establishes citizenship", () => {
  const captured = form([{ label: "Will you require sponsorship?" }]);
  assert.equal(planApplication(captured, bank(confirmed({ kind: "legal", intent: "sponsorship_needed",
    country: "US", value: null })), context).readyForEntry, false);
  const citizenship = form([{ label: "Citizenship" }]);
  assert.equal(planApplication(citizenship, bank(confirmed({ kind: "fact", value: "US" })), context).decisions[0].status, "blocked");
  const no = confirmed({ kind: "legal", intent: "sponsorship_needed", country: "US", value: "No" });
  assert.equal(planApplication(captured, bank(no), context).decisions[0].value, "No");
});

test("voluntary self-ID is never filled or copied into plan output, even from a populated bank", () => {
  const captured = form([{ label: "Voluntary disability self-identification", required: false }]);
  const result = planApplication(captured, bank(confirmed({ kind: "fact", value: "SENSITIVE_FIXTURE_SENTINEL" })), context);
  assert.equal(result.decisions[0].status, "self_id");
  assert.equal(result.decisions[0].canFill, false);
  assert.doesNotMatch(JSON.stringify(result), /SENSITIVE_FIXTURE_SENTINEL/);
});

test("required manual fields need a scoped acknowledgment; consent and other uploads stay manual", () => {
  const captured = form([{ label: "Agree to the privacy policy", type: "checkbox" }]);
  const answer = confirmed({ kind: "fact", value: true });
  assert.equal(planApplication(captured, bank(answer), context).readyForEntry, false);
  const acknowledged = { acknowledgement: { reference: "operator-a", openingId: "opening-a", questionId: "q", at } };
  const plan = planApplication(captured, bank(answer, acknowledged), context);
  assert.equal(plan.readyForEntry, true);
  assert.equal(plan.complete, false);
  assert.equal(plan.decisions[0].canFill, false);
  const cover = planApplication(form([{ label: "Cover letter", type: "file", attachment: "cover_letter" }]), bank(answer), context);
  assert.equal(cover.decisions[0].status, "manual");
  for (const label of ["I confirm the information is accurate", "I understand this declaration", "Subscribe to updates"]) {
    assert.equal(planApplication(form([{ label, type: "checkbox" }]), bank(answer), context).decisions[0].canFill, false);
  }
});

test("captured choices and constraints, not guessed values, determine fillability", () => {
  const answer = confirmed({ kind: "fact", value: "invalid" });
  const captured = form([{ type: "select", options: [{ label: "Yes", value: "yes" }] }]);
  assert.equal(planApplication(captured, bank(answer), context).decisions[0].canFill, false);
  assert.equal(planApplication(form([{ constraints: { maxLength: 3 } }]), bank(answer), context).readyForEntry, false);
  assert.equal(planApplication(form([{ type: "combobox" }]), bank(answer), context).readyForEntry, false);
  const numeric = confirmed({ kind: "fact", value: 42 });
  assert.equal(planApplication(form([{}]), bank(numeric), context).readyForEntry, false);
  assert.equal(planApplication(form([{}]), bank({ kind: "fact", value: "unconfirmed" }), context).readyForEntry, false);
});

test("a modified form and an empty capture fail offline planning", () => {
  const captured = form([{}]);
  captured.questions[0].required = false;
  assert.throws(() => planApplication(captured, bank({}), context), /changed|invalid/);
  assert.throws(() => planApplication(form([]), bank({}), context), /empty/);
});

test("the approved resume must match the captured attachment format rather than being rebuilt", () => {
  const captured = form([{ label: "Resume", type: "file", attachment: "resume",
    constraints: { accept: ".pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" } }]);
  const resume = { artifact: { path: "profile/resume/resume.md", sha256: "a".repeat(64) } };
  const incompatible = planApplication(captured, bank({}), { ...context, resume });
  assert.equal(incompatible.decisions[0].canFill, false);
  assert.match(incompatible.decisions[0].reason, /format/);
  for (const extension of ["pdf", "docx"]) {
    const compatible = { artifact: { ...resume.artifact, path: `profile/resume/resume.${extension}` } };
    assert.equal(planApplication(captured, bank({}), { ...context, resume: compatible }).decisions[0].canFill, true);
  }
});
