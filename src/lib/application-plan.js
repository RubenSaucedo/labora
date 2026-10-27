import { sha256 } from "./persona-files.js";
import { formFingerprint } from "./application-form.js";
import path from "node:path";

const SELF_ID = /\b(race|racial|ethnic\w*|gender|sex|sexual orientation|pronouns|hispanic|latino|latina|disabilit\w*|veteran|demographic|self[- ]identif\w*|national origin|religion|equal employment|EEO)\b/i;
const CONSENT = /\b(consent|privacy|acknowledge|agree|terms|certify|attest|declaration|subscribe|opt[- ]in|I (?:understand|confirm|accept))\b/i;
const COUNTRY_NAMES = {
  US: ["United States", "U.S.", "USA", "US"], CA: ["Canada"], GB: ["United Kingdom", "UK", "Great Britain"],
  AU: ["Australia"], NZ: ["New Zealand"], DE: ["Germany"], FR: ["France"], ES: ["Spain"],
  IT: ["Italy"], NL: ["Netherlands"], IE: ["Ireland"], IN: ["India"], MX: ["Mexico"],
  BR: ["Brazil"], SG: ["Singapore"], JP: ["Japan"], CH: ["Switzerland"], SE: ["Sweden"],
};

export function valueSha256(value) {
  return sha256(JSON.stringify(value));
}

export function legalIntent(label) {
  if (/\b(citizen\w*|nationality)\b/i.test(label)) return "citizenship";
  if (/\b(visa type|type of (?:visa|work authori[sz]ation)|authori[sz]ation type|immigration status)\b/i.test(label)) {
    return "authorization_type";
  }
  if (/\bwithout\b.*\bsponsor/i.test(label)) return "authorization_without_sponsorship";
  if (/\bsponsor/i.test(label)) return "sponsorship_needed";
  if (/\b(work authori[sz]|authori[sz]\w*.*work|legally.*work|right to work|eligible to work)\b/i.test(label)) {
    return "work_authorization";
  }
  return null;
}

export function questionCountry(question, openingCountry) {
  if (question.country) return /^[A-Z]{2}$/.test(question.country) ? question.country : null;
  const found = Object.entries(COUNTRY_NAMES).filter(([, names]) => names.some((name) =>
    new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question.label)));
  if (found.length === 1) return found[0][0];
  if (found.length > 1) return null;
  // An unrecognized explicit jurisdiction must not inherit the opening's country.
  if (/\b(?:in|of|for)\s+(?:the\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/.test(question.label)) return null;
  return /^[A-Z]{2}$/.test(openingCountry ?? "") ? openingCountry : null;
}

function exactConfirmation(answer) {
  return answer.confirmation?.reference?.trim() &&
    Number.isFinite(Date.parse(answer.confirmation.at)) &&
    answer.confirmation.valueSha256 === valueSha256(answer.value);
}

function exactApproval(answer, openingId, questionId) {
  const approval = answer.approval;
  return approval?.reference?.trim() && Number.isFinite(Date.parse(approval.at)) &&
    approval.openingId === openingId && approval.questionId === questionId &&
    approval.valueSha256 === valueSha256(answer.value);
}

function manualAcknowledged(binding, openingId, questionId) {
  const acknowledgement = binding?.acknowledgement;
  return Boolean(acknowledgement?.reference?.trim() &&
    acknowledgement.openingId === openingId && acknowledgement.questionId === questionId &&
    Number.isFinite(Date.parse(acknowledgement.at)));
}

function invalidValue(question, value) {
  const choices = question.options ?? [];
  if (["radio-group", "select", "checkbox-group"].includes(question.type)) {
    const values = Array.isArray(value) ? value : [value];
    if (question.type !== "checkbox-group" && values.length !== 1) return "Choose exactly one captured option.";
    if (values.some((item) => !choices.some((option) => option.value === item && !option.disabled))) {
      return "The answer is not an available captured option; review the exact form wording.";
    }
  }
  if (question.type === "checkbox" && typeof value !== "boolean") return "A single checkbox needs an explicit boolean answer.";
  if (!["checkbox", "checkbox-group", "radio-group", "select"].includes(question.type) && typeof value !== "string") {
    return "This control needs exact text, not an inferred conversion.";
  }
  const constraints = question.constraints ?? {};
  if (typeof value === "string") {
    if (constraints.maxLength >= 0 && value.length > constraints.maxLength) return "The proposed text exceeds the captured length limit.";
    if (constraints.minLength > value.length) return "The proposed text is shorter than the captured minimum.";
  }
  if (question.required && (value === "" || (Array.isArray(value) && value.length === 0) ||
      (question.type === "checkbox" && value === false))) return "The required control still has no affirmative value.";
  return null;
}

function acceptsArtifact(question, artifact) {
  const accept = question.constraints?.accept?.trim();
  if (!accept) return true;
  const extension = path.extname(artifact.path).toLowerCase();
  const mime = {
    ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword", ".md": "text/markdown", ".txt": "text/plain",
  }[extension];
  return accept.toLowerCase().split(",").some((entry) => {
    const allowed = entry.trim();
    return allowed === extension || (mime && (allowed === mime || allowed === `${mime.split("/")[0]}/*`));
  });
}

export function planApplication(form, bank, { openingId, country, resume = null, resumeFinding = null } = {}) {
  if (!openingId || form.schemaVersion !== "1.0" || !form.questions?.length ||
      form.snapshotHash !== formFingerprint(form) ||
      new Set(form.questions.map((question) => question.id)).size !== form.questions.length) {
    throw new Error("The captured form is empty, changed or invalid; obtain a fresh observation.");
  }
  if (bank.schemaVersion !== "1.0" || !bank.answers || !bank.bindings) {
    throw new Error("The answer bank needs schemaVersion 1.0, explicit answers and question bindings.");
  }
  const decisions = form.questions.map((question) => {
    const result = {
      questionId: question.id, label: question.label, required: question.required,
      type: question.type, status: "manual", canFill: false,
    };
    const binding = bank.bindings[question.id];
    const manual = (reason) => ({ ...result, reason,
      acknowledged: manualAcknowledged(binding, openingId, question.id) });
    if (SELF_ID.test(question.label)) return { ...result, status: "self_id", reason: "Voluntary self-identification stays untouched; no answer is retained." };
    if (question.disabled || question.readOnly || ["combobox", "unsupported"].includes(question.type)) {
      return manual("This control cannot be entered safely; leave it for the operator.");
    }
    if (question.type === "file") {
      if (question.attachment === "resume" && resume) {
        if (!acceptsArtifact(question, resume.artifact)) {
          return manual("The approved artifact does not match the captured upload format; select an approved supported artifact without rebuilding it implicitly.");
        }
        return { ...result, status: "ready", canFill: true, artifact: resume.artifact,
          reason: "Attach only the exact verified shared artifact." };
      }
      return manual(question.attachment === "resume" ? resumeFinding ?? "Select an exact approved resume first."
        : "This is not a resume upload; leave other attachments for the operator.");
    }
    const intent = legalIntent(question.label);
    if (!intent && CONSENT.test(question.label)) return manual("Consent and declarations are operator actions, not inferred facts.");
    const answer = binding?.answer ? bank.answers[binding.answer] : null;
    if (intent) {
      const jurisdiction = questionCountry(question, country);
      if (!jurisdiction || answer?.kind !== "legal" || answer.intent !== intent ||
          answer.country !== jurisdiction || answer.value == null || !exactConfirmation(answer)) {
        return { ...result, status: "blocked", jurisdiction, intent,
          reason: "Ask for this exact legal answer, intent and country; no answer was inferred." };
      }
      const invalid = invalidValue(question, answer.value);
      return invalid ? manual(invalid) : { ...result, status: "ready", canFill: true,
        jurisdiction, intent, value: answer.value, reason: "Explicit country-and-intent-specific confirmation." };
    }
    if (!answer || answer.value == null || answer.kind === "manual") {
      return manual("No confirmed answer is available; the operator can answer or handle this field manually.");
    }
    const invalid = invalidValue(question, answer.value);
    if (invalid) return manual(invalid);
    if (answer.kind === "fact" && exactConfirmation(answer)) {
      return { ...result, status: "ready", canFill: true, value: answer.value,
        reason: "An explicitly confirmed shared fact." };
    }
    if (["draft", "essay"].includes(answer.kind)) {
      const approved = Boolean(exactApproval(answer, openingId, question.id));
      return { ...result, status: answer.kind === "essay" ? "essay" : "confirm",
        value: answer.value, canFill: approved, approved,
        valueSha256: valueSha256(answer.value),
        reason: approved ? "Exact text approved for this question and opening."
          : "Read back this exact proposal; approval of a field name alone is insufficient." };
    }
    return manual("The proposed fact has not been explicitly confirmed; do not promote a draft or preference to a fact.");
  });
  const unresolvedRequired = decisions.filter((decision) => decision.required && !decision.canFill &&
    !(decision.status === "manual" && decision.acknowledged));
  return {
    schemaVersion: "1.0", openingId, country: country ?? null,
    formUrl: form.url, formHash: form.snapshotHash,
    bankHash: sha256(JSON.stringify(bank)), resume, resumeFinding,
    decisions, readyForEntry: unresolvedRequired.length === 0,
    complete: decisions.every((decision) => decision.canFill || (!decision.required && decision.status === "self_id")),
    unresolvedRequired: unresolvedRequired.map((decision) => decision.questionId),
  };
}

export function planReviewMarkdown(plan) {
  const lines = plan.decisions.map((decision) => {
    const value = decision.status === "self_id" ? "" :
      decision.artifact ? `\nArtifact: ${decision.artifact.path} (${decision.artifact.sha256})\n` :
        Object.hasOwn(decision, "value") ? `\nExact proposed value:\n${JSON.stringify(decision.value)}\n` : "";
    return `### ${decision.questionId}: ${decision.label}\n\n` +
      `${decision.status}; ${decision.canFill ? "entry permitted" : "not entered"}${decision.required ? "; required" : ""}\n` +
      `${value}\n${decision.reason}\n`;
  });
  return `## Application-entry review\n\n${plan.readyForEntry ? "Ready for a separately requested entry pass." :
    "Required answers remain unresolved; entry has not started."}\n` +
    `Incomplete fields remain visible; only the operator submits.\n\n${lines.join("\n")}`;
}
