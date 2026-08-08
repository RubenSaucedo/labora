#!/usr/bin/env node
// Validate a persona's generated profile on its own, with no job and no resume.
//
// `validate-claims.js` answers "is this resume supported by the ledger?" and so
// requires a resume. The profile stage needs the question one step earlier: "is
// this ledger internally sound, and is every identity record actually grounded?"
// Without this, the profile stage has no definition of done and its correctness
// depends on whoever remembers to check it by hand.
//
// It works by validating the identity record against itself: a synthetic resume
// that renders every catalog section. If a certification, project, award or
// degree is not grounded in a verified claim, it surfaces here rather than on
// the day a real application is assembled.

import fs from "node:fs";
import path from "node:path";

import { validateResumeClaims } from "../lib/validate-resume-claims.js";
import { normalizeIdentity } from "../lib/normalize-identity.js";
import { ZAccomplishmentBank } from "../schemas/accomplishments.js";
import { ZClaimLedger } from "../schemas/provenance.js";
import { resolvePersonaRoot } from "../lib/workspace.js";

export function buildSelfResume(identity) {
  return {
    schema_version: "3.0",
    target_role: "",
    ats_title: "",
    contact: {},
    summary: "",
    experience: [],
    education: identity.education || [],
    projects: identity.projects || [],
    certifications: identity.certifications || [],
    awards_or_contributions: identity.awards_or_contributions || [],
    skills: [],
    keywords_mapped: [],
    provenance: { bullets: [], skills: [] },
  };
}

export function summarize({ identity, ledger, bank }) {
  const claims = ledger.claims || [];
  const byStatus = {};
  for (const claim of claims) byStatus[claim.status] = (byStatus[claim.status] || 0) + 1;

  const units = bank?.units || [];
  const referenced = new Set(units.flatMap((unit) => unit.claimIds || []));

  return {
    claims: claims.length,
    claimsByStatus: byStatus,
    experience: (identity.experience || []).length,
    education: (identity.education || []).length,
    projects: (identity.projects || []).length,
    certifications: (identity.certifications || []).length,
    awards: (identity.awards_or_contributions || []).length,
    accomplishmentUnits: units.length,
    claimsReferencedByBank: [...referenced].filter((id) => claims.some((c) => c.id === id)).length,
  };
}

export function validateProfile(personaRoot, { workspaceRoot = process.cwd() } = {}) {
  const generated = path.join(personaRoot, "profile", "generated");
  const identityPath = path.join(generated, "identity.json");
  const ledgerPath = path.join(generated, "claims.json");
  const bankPath = path.join(generated, "accomplishments.json");

  for (const required of [identityPath, ledgerPath]) {
    if (!fs.existsSync(required)) {
      throw new Error(`missing ${path.relative(workspaceRoot, required)} — run resume-persona first`);
    }
  }

  const identity = normalizeIdentity(JSON.parse(fs.readFileSync(identityPath, "utf8")));
  const ledger = ZClaimLedger.parse(JSON.parse(fs.readFileSync(ledgerPath, "utf8")));
  const bank = fs.existsSync(bankPath)
    ? ZAccomplishmentBank.parse(JSON.parse(fs.readFileSync(bankPath, "utf8")))
    : null;

  const result = validateResumeClaims({
    resume: buildSelfResume(identity),
    identity,
    ledger,
    bank,
    workspaceRoot,
    personaRoot,
  });

  // The synthetic resume deliberately renders every catalog section, so a
  // complaint that it omits a required exact section is an artefact of this
  // harness rather than a defect in the profile.
  const issues = result.issues.filter((i) => i.code !== "identity_section_mismatch");

  return {
    valid: issues.every((i) => i.severity !== "error"),
    issues,
    summary: summarize({ identity, ledger, bank }),
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const personaArg = process.argv[2];
  if (!personaArg) {
    process.stderr.write("Usage: node src/tools/validate-profile.js <persona-root|persona-name>\n");
    process.exit(1);
  }
  const personaRoot = fs.existsSync(personaArg) ? personaArg : resolvePersonaRoot(personaArg);

  try {
    const { valid, issues, summary } = validateProfile(personaRoot);
    const s = summary;
    process.stdout.write(
      `${path.basename(personaRoot)}: ${s.claims} claims (${JSON.stringify(s.claimsByStatus)})\n` +
        `  experience ${s.experience} | education ${s.education} | projects ${s.projects} | ` +
        `certifications ${s.certifications} | awards ${s.awards}\n` +
        `  accomplishment units ${s.accomplishmentUnits}, grounding ${s.claimsReferencedByBank} claims\n`,
    );
    for (const i of issues) {
      process.stdout.write(`  [${i.severity}] ${i.code}: ${i.message}\n`);
    }
    process.stdout.write(valid ? "profile VALID\n" : "profile INVALID\n");
    if (!valid) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`validate-profile error: ${error.message}\n`);
    process.exit(1);
  }
}
