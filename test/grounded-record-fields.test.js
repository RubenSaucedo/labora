import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GROUNDED_RECORD_FIELDS, validateResumeClaims } from "../src/lib/validate-resume-claims.js";
import {
  ZExperience,
  ZEducation,
  ZProject,
  ZCertification,
  ZAward,
} from "../src/schemas/identity.js";

const SCHEMAS = {
  experience: ZExperience,
  education: ZEducation,
  projects: ZProject,
  certifications: ZCertification,
  awards_or_contributions: ZAward,
};

function schemaFields(schema) {
  return Object.keys(schema.shape).sort();
}

function classifiedFields(spec) {
  return [...spec.prose, ...spec.dates, ...(spec.soft || []), ...spec.composed, ...spec.notFactual].sort();
}

// The defect this guards against is not a wrong classification, it is an
// *unclassified* field: `issuer` and `year` rendered on real resumes for as
// long as the check carried a hand-written list of field names beside a schema
// that grew without it. Comparing both directions is what makes adding a field
// to a schema a failing test rather than a silent hole.
test("every rendered schema field is classified exactly once", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const spec = GROUNDED_RECORD_FIELDS[name];
    assert.ok(spec, `${name} has no grounding classification`);
    assert.deepEqual(
      classifiedFields(spec),
      schemaFields(schema),
      `${name}: classification and schema disagree`
    );
  }
});

test("no field is classified into two buckets", () => {
  for (const [name, spec] of Object.entries(GROUNDED_RECORD_FIELDS)) {
    const all = [...spec.prose, ...spec.dates, ...(spec.soft || []), ...spec.composed, ...spec.notFactual];
    assert.equal(new Set(all).size, all.length, `${name} classifies a field twice`);
  }
});

const PERSONA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "labora-grounding-"));

function fixture(identityOverrides) {
  return {
    resume: {
      contact: {},
      summary: "",
      experience: [],
      skills: [],
      education: [],
      projects: [],
      certifications: [],
      awards_or_contributions: [],
      keywords_mapped: [],
      gaps_or_risks: [],
      notes_for_human: [],
      provenance: { summaryClaimIds: [], bullets: [], skills: [] },
    },
    identity: {
      name: "Test Person",
      headline: "",
      identity_prose: [],
      experience: [],
      other_experience_compacted: [],
      education: [],
      projects: [],
      certifications: [],
      awards_or_contributions: [],
      skill_vetoes: [],
      legacy_skills: [],
      ...identityOverrides,
    },
    ledger: {
      claims: [{
        id: "C1",
        status: "verified",
        fact: "Earned the AWS Solutions Architect certification from Amazon Web Services in 2021.",
        period: "2021",
        sources: [],
      }],
    },
    bank: { accomplishments: [] },
    personaRoot: PERSONA_ROOT,
  };
}

function issuesFrom(identityOverrides) {
  const { issues } = validateResumeClaims(fixture(identityOverrides));
  return issues;
}

test("a certification attributed to the wrong issuer is rejected", () => {
  const issues = issuesFrom({
    certifications: [{
      name: "AWS Solutions Architect",
      issuer: "Google Cloud",
      year: "2021",
      credential_id: "",
      credential_url: "",
    }],
  });
  const found = issues.find((i) => i.code === "identity_record_unproven");
  assert.ok(found, "an unsupported issuer must be reported");
  assert.match(found.message, /issuer/);
});

test("a certification dated to a year evidence does not state is rejected", () => {
  const issues = issuesFrom({
    certifications: [{
      name: "AWS Solutions Architect",
      issuer: "Amazon Web Services",
      year: "2024",
      credential_id: "",
      credential_url: "",
    }],
  });
  const found = issues.find((i) => i.code === "identity_record_unproven");
  assert.ok(found, "an unsupported year must be reported");
  assert.match(found.message, /year/);
});

test("a fully grounded certification passes", () => {
  const issues = issuesFrom({
    certifications: [{
      name: "AWS Solutions Architect",
      issuer: "Amazon Web Services",
      year: "2021",
      credential_id: "",
      credential_url: "",
    }],
  });
  assert.equal(issues.filter((i) => i.code === "identity_record_unproven").length, 0);
});

// A record with every field blank used to satisfy `every` vacuously and so was
// reported as grounded by any verified claim.
test("a record with nothing checkable is not vacuously grounded", () => {
  const issues = issuesFrom({
    certifications: [{ name: "", issuer: "", year: "", credential_id: "", credential_url: "" }],
  });
  const found = issues.find((i) => i.code === "identity_record_unproven");
  assert.ok(found, "an empty record must be reported rather than passing");
  assert.match(found.message, /no checkable content/);
});

// Per PHILOSOPHY.md an assurance failure states the repair, not just the
// refusal, so the operator is never left holding an error they cannot act on.
test("the rejection names the field and the repair", () => {
  const issues = issuesFrom({
    certifications: [{
      name: "AWS Solutions Architect",
      issuer: "Google Cloud",
      year: "2021",
      credential_id: "",
      credential_url: "",
    }],
  });
  const found = issues.find((i) => i.code === "identity_record_unproven");
  assert.match(found.message, /Add a source excerpt|correct the entry/);
});
