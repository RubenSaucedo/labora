import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { formatProgression } from "../src/agents/format-resume.js";
import { validateResumeClaims } from "../src/lib/validate-resume-claims.js";

const PERSONA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "progression-persona-"));

test("generic promotion placeholders are suppressed by default", () => {
  const line = formatProgression([
    { label: "Level 60", externalLabel: "Promoted", date: "2021", disclosure: "internal_generalizable" },
    { label: "L62", externalLabel: "Promoted", date: "2024", disclosure: "internal_generalizable" },
  ]);
  assert.equal(line, "");
});

test("verified career jumps can explicitly preserve a promotion signal", () => {
  const line = formatProgression([
    {
      label: "Level 60",
      externalLabel: "Promoted",
      externalLabelKind: "scope_change",
      date: "2021",
      disclosure: "internal_generalizable",
    },
    {
      label: "L62",
      externalLabel: "Promoted",
      externalLabelKind: "scope_change",
      date: "2024",
      disclosure: "internal_generalizable",
    },
  ]);
  assert.equal(line, "Promoted twice (2021, 2024)");
  assert.ok(!line.includes("L62"), "internal ladder token must never render");
  assert.ok(!line.includes("Level 60"), "internal ladder token must never render");
});

test("distinct titles render as a progression chain", () => {
  assert.equal(
    formatProgression([
      { label: "Engineer", date: "2020", disclosure: "public" },
      { label: "Senior Engineer", date: "2023", disclosure: "public" },
    ]),
    "Engineer, 2020 | Senior Engineer, 2023",
  );
});

test("generic and heading-duplicate nodes leave no progression line", () => {
  assert.equal(
    formatProgression([
      { label: "Internal A", externalLabel: "Promoted", date: "2020", disclosure: "internal_generalizable" },
      { label: "Internal B", externalLabel: "Senior Engineer", date: "2022", disclosure: "internal_generalizable" },
      { label: "Internal C", externalLabel: "Promoted", date: "2023", disclosure: "internal_generalizable" },
    ], "Senior Engineer"),
    "",
  );
});

test("real historical titles render while the current heading duplicate is removed", () => {
  assert.equal(
    formatProgression([
      { label: "Engineer", date: "2020", disclosure: "public" },
      { label: "Senior Engineer", date: "2022", disclosure: "public" },
      { label: "Lead Engineer", date: "2024", disclosure: "public" },
    ], "Lead Engineer"),
    "Engineer, 2020 | Senior Engineer, 2022",
  );
});

test("internal_only progression is withheld entirely", () => {
  assert.equal(formatProgression([{ label: "L63", date: "2026", disclosure: "internal_only" }]), "");
});

test("progression with no disclosure is withheld", () => {
  assert.equal(formatProgression([{ label: "L63", date: "2026" }]), "");
});

test("internal_generalizable progression without an external label is withheld", () => {
  assert.equal(
    formatProgression([{ label: "L63", externalLabel: "", date: "2026", disclosure: "internal_generalizable" }]),
    "",
  );
});

test("progression tolerates absent input", () => {
  assert.equal(formatProgression(undefined), "");
  assert.equal(formatProgression([]), "");
});

function gateFixture(progression) {
  const identity = {
    experience: [
      {
        id: "microsoft",
        company: "MICROSOFT",
        role: "SOFTWARE ENGINEER 2",
        period: "2020–Present",
        progression: [
          { label: "L62", externalLabel: "Promoted", date: "2024", disclosure: "internal_generalizable", claimIds: ["claim-l62"] },
        ],
      },
    ],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
  };
  const ledger = {
    claims: [
      {
        id: "claim-l62",
        type: "role",
        fact: "SOFTWARE ENGINEER 2 at MICROSOFT. Promoted to L62.",
        period: "2024",
        sources: [],
        status: "verified",
        disclosure: "internal_generalizable",
        externalFact: "Promoted in 2024.",
        externalSources: [],
      },
    ],
  };
  const resume = {
    target_role: "x",
    ats_title: "x",
    summary: "",
    experience: [
      { id: "microsoft", company: "MICROSOFT", role: "SOFTWARE ENGINEER 2", period: "2020–Present", bullets: [], progression },
    ],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
    skills: [],
  };
  return { resume, identity, ledger, personaRoot: PERSONA_ROOT };
}

function codes(progression) {
  const result = validateResumeClaims(gateFixture(progression));
  return result.issues.map((i) => i.code);
}

test("a fabricated promotion is rejected", () => {
  const found = codes([
    { label: "VP of Engineering", externalLabel: "Promoted", date: "2025", disclosure: "public", claimIds: [] },
  ]);
  assert.ok(found.includes("progression_not_in_identity"), `expected rejection, got ${found.join(", ")}`);
});

test("a promotion with no claim provenance is rejected", () => {
  const found = codes([
    { label: "L62", externalLabel: "Promoted", date: "2024", disclosure: "internal_generalizable", claimIds: [] },
  ]);
  assert.ok(found.includes("unmapped_progression"), `expected rejection, got ${found.join(", ")}`);
});

test("an internal ladder token without an external label is rejected", () => {
  const found = codes([
    { label: "L62", externalLabel: "", date: "2024", disclosure: "internal_generalizable", claimIds: ["claim-l62"] },
  ]);
  assert.ok(
    found.includes("progression_label_not_generalized"),
    `expected rejection, got ${found.join(", ")}`,
  );
});

test("an unclassified progression step is withheld with a warning", () => {
  const found = codes([
    { label: "L62", externalLabel: "Promoted", date: "2024", claimIds: ["claim-l62"] },
  ]);
  assert.ok(
    found.includes("progression_disclosure_unclassified"),
    `expected warning, got ${found.join(", ")}`,
  );
  assert.ok(
    !found.includes("progression_not_in_identity"),
    `withheld unclassified steps should not be evaluated as rendered promotions, got ${found.join(", ")}`,
  );
});

test("a correctly grounded promotion passes the gate", () => {
  const found = codes([
    { label: "L62", externalLabel: "Promoted", date: "2024", disclosure: "internal_generalizable", claimIds: ["claim-l62"] },
  ]);
  assert.ok(found.includes("progression_generic_placeholder"));
  assert.ok(found.includes("progression_low_information"));
  assert.ok(!found.includes("unmapped_progression"));
});

// A step is matched to the identity record by `label`, but `formatProgression`
// renders `externalLabel` in its place whenever one is set, plus `date`.
// Checking `label` alone let the rendered title and year say anything while the
// step still resolved to a real, claim-backed promotion.
test("a promotion whose rendered label was rewritten is rejected", () => {
  const found = codes([
    { label: "L62", externalLabel: "Distinguished Principal Architect", date: "2024", disclosure: "internal_generalizable", claimIds: ["claim-l62"] },
  ]);
  assert.ok(
    found.includes("progression_identity_changed"),
    `the label that actually renders must match the identity record, got ${found.join(", ")}`,
  );
});

test("a promotion whose date was rewritten is rejected", () => {
  const found = codes([
    { label: "L62", externalLabel: "Promoted", date: "2019", disclosure: "internal_generalizable", claimIds: ["claim-l62"] },
  ]);
  assert.ok(
    found.includes("progression_identity_changed"),
    `an invented promotion date must be rejected, got ${found.join(", ")}`,
  );
});

test("a promotion whose optional render semantics were rewritten is rejected", () => {
  const input = gateFixture([{
    label: "L62",
    externalLabel: "Promoted",
    externalLabelKind: "scope_change",
    date: "2024",
    disclosure: "internal_generalizable",
    claimIds: ["claim-l62"],
  }]);
  const result = validateResumeClaims(input);
  assert.ok(
    result.issues.some((entry) => entry.code === "progression_identity_changed"),
    `render semantics must match the identity record, got ${JSON.stringify(result.issues)}`,
  );
});

test("legibility findings stay warnings rather than progression errors", () => {
  const result = validateResumeClaims(gateFixture([
    { label: "L62", externalLabel: "Promoted", date: "2024", disclosure: "internal_generalizable", claimIds: ["claim-l62"] },
  ]));
  const findings = result.issues.filter((entry) => entry.code.startsWith("progression_"));
  assert.ok(findings.some((entry) => entry.code === "progression_generic_placeholder"));
  assert.ok(findings.some((entry) => entry.code === "progression_low_information"));
  assert.ok(findings.every((entry) => entry.severity === "warning"));
});

test("a progression node duplicating the role heading produces a warning", () => {
  const input = gateFixture([{
    label: "L62",
    externalLabel: "SOFTWARE ENGINEER 2",
    date: "2024",
    disclosure: "internal_generalizable",
    claimIds: ["claim-l62"],
  }]);
  input.identity.experience[0].progression = structuredClone(input.resume.experience[0].progression);
  const result = validateResumeClaims(input);
  const finding = result.issues.find((entry) => entry.code === "progression_duplicates_heading");
  assert.equal(finding?.severity, "warning");
});
