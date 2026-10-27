import fs from "node:fs";
import { personaPath, readJson, sha256 } from "./persona-files.js";
import { readApplicationWorkspace, updateOpening } from "./application-workspace.js";

function matchingBytes(root, reference, label) {
  if (!reference?.path || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? "")) {
    throw new Error(`The ${label} needs an explicit path and SHA-256 approval reference.`);
  }
  const file = personaPath(root, reference.path);
  if (!fs.existsSync(file)) {
    throw new Error(`The ${label} reference is missing; restore it or declare its exact relocation. No substitute was selected.`);
  }
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== reference.sha256) {
    throw new Error(`${label} hash mismatch; pause upload and resolve the exact approval. No rebuild or substitution was performed.`);
  }
  return bytes;
}

function approvedSource(root, source, relocationsFile) {
  if (!source?.path || !source.sha256) throw new Error("The approval must record its renderer source path and hash.");
  let matches = [];
  if (relocationsFile) {
    const records = readJson(personaPath(root, relocationsFile));
    if (records.schemaVersion !== "1.0" || !Array.isArray(records.relocations)) {
      throw new Error("Unrecognized relocation record; preserve the approval and correct the separate mapping.");
    }
    matches = records.relocations.filter((record) => record.from === source.path);
  }
  if (matches.length > 1) throw new Error("Ambiguous source relocation; declare exactly one destination.");
  const relocation = matches[0];
  if (relocation && relocation.sha256 !== source.sha256) {
    throw new Error("Relocation hash mismatch; the mapping must retain the approval's original source hash.");
  }
  const resolved = { path: relocation?.to ?? source.path, sha256: source.sha256 };
  matchingBytes(root, resolved, "Source");
  return { ...resolved, originalPath: source.path };
}

export function verifyDefaultResume(root, { descriptor } = {}) {
  const selected = descriptor ?? readApplicationWorkspace(root).contract?.defaultResume;
  if (!selected) {
    throw new Error("Ask the operator to designate a default resume descriptor; a filename is not approval.");
  }
  const descriptorBytes = fs.readFileSync(personaPath(root, selected));
  const current = JSON.parse(descriptorBytes);
  if (current.schemaVersion !== "1.0") throw new Error("Unrecognized default resume descriptor version.");
  const approvalBytes = matchingBytes(root, current.approval, "Approval");
  const approval = JSON.parse(approvalBytes);
  matchingBytes(root, current.artifact, "Artifact");
  if (approval.schemaVersion !== "1.0" || !approval.reference?.trim() ||
      !Number.isFinite(Date.parse(approval.approvedAt))) {
    throw new Error("An explicit operator approval reference and approval time are required; do not infer them from filenames.");
  }
  if (approval.artifact?.sha256 !== current.artifact.sha256) {
    throw new Error("The exact snapshot does not approve these artifact bytes; obtain a separate approval, never reuse the old one.");
  }
  const source = approvedSource(root, approval.source, current.relocations);
  return {
    descriptor: { path: selected, sha256: sha256(descriptorBytes) },
    artifact: { ...current.artifact }, approval: { ...current.approval },
    source, approvedAt: approval.approvedAt, approvalReference: approval.reference,
    acceptedFindings: approval.acceptedFindings ?? [],
  };
}

export function selectDefaultResume(root, openingId, { descriptor, apply = false } = {}) {
  const resume = verifyDefaultResume(root, { descriptor });
  return updateOpening(root, openingId, (entry) => ({ ...entry, resume }), { apply });
}
