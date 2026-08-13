import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateResumeClaims } from "../src/lib/validate-resume-claims.js";
import { resumeJsonToHtml } from "../src/agents/format-resume.js";

const PERSONA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "identity-prose-persona-"));

/**
 * Composed prose in an identity record used to validate against itself: a
 * project `name` was grounded against evidence, the `description` beside it was
 * grounded against nothing, and the resume then validated by exact-object match
 * against that same record. These fixtures pin the gate that closed it.
 */
function fixture({ projects = [], awards = [] } = {}) {
  const identity = {
    experience: [],
    education: [],
    projects,
    certifications: [],
    awards_or_contributions: awards,
  };
  const ledger = {
    claims: [
      {
        id: "claim-labora",
        type: "project",
        fact: "Built Labora, an evidence-grounded resume assurance system.",
        period: "2026",
        sources: [],
        status: "verified",
        disclosure: "public",
      },
      {
        id: "claim-draft",
        type: "project",
        fact: "Built Labora, an evidence-grounded resume assurance system.",
        period: "2026",
        sources: [],
        status: "draft",
        disclosure: "public",
      },
      {
        id: "claim-secret",
        type: "project",
        fact: "Built Labora, an evidence-grounded resume assurance system.",
        period: "2026",
        sources: [],
        status: "verified",
        disclosure: "internal_only",
      },
    ],
  };
  const resume = {
    target_role: "x",
    ats_title: "x",
    summary: "",
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
    skills: [],
  };
  return { resume, identity, ledger, personaRoot: PERSONA_ROOT };
}

function codesFor(input) {
  return validateResumeClaims(fixture(input)).issues.map((i) => i.code);
}

test("a project description with no claim provenance is rejected", () => {
  const found = codesFor({
    projects: [{
      name: "Labora",
      description: "Led a team of twelve and drove adoption across four organizations.",
      highlights: [],
      link: "",
      claimIds: [],
    }],
  });
  assert.ok(
    found.includes("identity_prose_unmapped"),
    `ungrounded description must be rejected, got ${found.join(", ")}`,
  );
});

test("project highlights alone require provenance", () => {
  const found = codesFor({
    projects: [{
      name: "Labora",
      description: "",
      highlights: ["Scaled the system to millions of users."],
      link: "",
      claimIds: [],
    }],
  });
  assert.ok(
    found.includes("identity_prose_unmapped"),
    `an ungrounded highlight must be rejected, got ${found.join(", ")}`,
  );
});

test("an award description with no claim provenance is rejected", () => {
  const found = codesFor({
    awards: [{
      title: "Labora",
      description: "Recognized company-wide for outstanding technical leadership.",
      year: "2026",
      link: "",
      claimIds: [],
    }],
  });
  assert.ok(
    found.includes("identity_prose_unmapped"),
    `an ungrounded award description must be rejected, got ${found.join(", ")}`,
  );
});

test("a record carrying no prose needs no claim provenance", () => {
  const found = codesFor({
    projects: [{ name: "Labora", description: "", highlights: [], link: "https://example.com", claimIds: [] }],
  });
  assert.ok(
    !found.includes("identity_prose_unmapped"),
    `a record that renders no prose must not be gated, got ${found.join(", ")}`,
  );
});

test("prose citing a claim that does not exist is rejected", () => {
  const found = codesFor({
    projects: [{
      name: "Labora",
      description: "An evidence-grounded resume assurance system.",
      highlights: [],
      link: "",
      claimIds: ["claim-does-not-exist"],
    }],
  });
  assert.ok(found.includes("unknown_claim"), `expected unknown_claim, got ${found.join(", ")}`);
});

test("prose citing an unverified claim is rejected", () => {
  const found = codesFor({
    projects: [{
      name: "Labora",
      description: "An evidence-grounded resume assurance system.",
      highlights: [],
      link: "",
      claimIds: ["claim-draft"],
    }],
  });
  assert.ok(found.includes("unverified_claim"), `expected unverified_claim, got ${found.join(", ")}`);
});

test("prose citing an internal_only claim may not render", () => {
  const found = codesFor({
    projects: [{
      name: "Labora",
      description: "An evidence-grounded resume assurance system.",
      highlights: [],
      link: "",
      claimIds: ["claim-secret"],
    }],
  });
  assert.ok(
    found.includes("confidential_claim_rendered"),
    `expected confidential_claim_rendered, got ${found.join(", ")}`,
  );
});

test("project prose substantively supported by its mapped claim passes the gate", () => {
  const found = codesFor({
    projects: [{
      name: "Labora",
      description: "An evidence-grounded resume assurance system.",
      highlights: ["Built an evidence-grounded resume system."],
      link: "",
      claimIds: ["claim-labora"],
    }],
  });
  const proseIssues = found.filter((code) => code.startsWith("identity_prose_")
    || code === "unknown_claim"
    || code === "unverified_claim"
    || code === "confidential_claim_rendered");
  assert.deepEqual(proseIssues, []);
});

test("blanket-mapping a claim does not support unrelated identity prose", () => {
  const found = codesFor({
    projects: [{
      name: "Labora",
      description: "Every rendered bullet maps to a verified claim.",
      highlights: [],
      link: "",
      claimIds: ["claim-labora"],
    }],
  });
  assert.ok(
    found.includes("identity_prose_claim_mismatch"),
    `unrelated prose must not pass by citing any verified claim, got ${found.join(", ")}`,
  );
});

test("identity prose cannot introduce unsupported named or numeric content", () => {
  const found = codesFor({
    projects: [{
      name: "Labora",
      description: "An ATS platform serving 2 million users.",
      highlights: [],
      link: "",
      claimIds: ["claim-labora"],
    }],
  });
  assert.ok(
    found.includes("identity_prose_unsupported_content"),
    `unsupported names and numbers must be rejected, got ${found.join(", ")}`,
  );
});

test("each project highlight is checked against the mapped claims", () => {
  const input = fixture({
    projects: [{
      name: "Labora",
      description: "An evidence-grounded resume assurance system.",
      highlights: [
        "Built an evidence-grounded resume system.",
        "Managed enterprise infrastructure worldwide.",
      ],
      link: "",
      claimIds: ["claim-labora"],
    }],
  });
  const issues = validateResumeClaims(input).issues;
  assert.ok(
    issues.some((entry) =>
      entry.code === "identity_prose_claim_mismatch"
      && entry.location === "identity.projects[0].highlights[1]"
    ),
    `the unsupported highlight must be identified precisely, got ${JSON.stringify(issues)}`,
  );
});

test("award descriptions are checked against their mapped claims", () => {
  const found = codesFor({
    awards: [{
      title: "Labora",
      description: "Recognized for managing enterprise infrastructure worldwide.",
      year: "2026",
      link: "",
      claimIds: ["claim-labora"],
    }],
  });
  assert.ok(
    found.includes("identity_prose_claim_mismatch"),
    `unsupported award prose must be rejected, got ${found.join(", ")}`,
  );
});

// Resume records validate by exact-object match against the identity record.
// `claimIds` is provenance, not rendered content, so it is excluded from that
// key: a tailor that copies the visible record faithfully but omits the
// metadata must not be accused of inventing the entry.
test("a resume project copied from the identity record still matches", () => {
  const project = {
    name: "Labora",
    description: "An evidence-grounded resume assurance system.",
    highlights: [],
    link: "",
    claimIds: ["claim-labora"],
  };
  const input = fixture({ projects: [project] });
  input.resume.projects = [{ ...project }];
  const found = validateResumeClaims(input).issues.map((i) => i.code);
  assert.ok(
    !found.includes("identity_section_unsupported"),
    `a verbatim copy must remain supported, got ${found.join(", ")}`,
  );
});

test("a resume project that omits claimIds is not treated as fabricated", () => {
  const project = {
    name: "Labora",
    description: "An evidence-grounded resume assurance system.",
    highlights: [],
    link: "",
    claimIds: ["claim-labora"],
  };
  const input = fixture({ projects: [project] });
  input.resume.projects = [{ name: "Labora", description: project.description, highlights: [], link: "" }];
  const found = validateResumeClaims(input).issues.map((i) => i.code);
  assert.ok(
    !found.includes("identity_section_unsupported"),
    `provenance is not rendered content and must not drive the fabrication check, got ${found.join(", ")}`,
  );
});

test("claim id ordering does not decide whether an entry was fabricated", () => {
  const input = fixture({
    projects: [{
      name: "Labora",
      description: "An evidence-grounded resume assurance system.",
      highlights: [],
      link: "",
      claimIds: ["claim-labora", "claim-draft"],
    }],
  });
  input.resume.projects = [{
    name: "Labora",
    description: "An evidence-grounded resume assurance system.",
    highlights: [],
    link: "",
    claimIds: ["claim-draft", "claim-labora"],
  }];
  const found = validateResumeClaims(input).issues.map((i) => i.code);
  assert.ok(
    !found.includes("identity_section_unsupported"),
    `reordered provenance is the same provenance, got ${found.join(", ")}`,
  );
});

test("a resume project the identity record does not contain is still rejected", () => {
  const input = fixture({
    projects: [{
      name: "Labora",
      description: "An evidence-grounded resume assurance system.",
      highlights: [],
      link: "",
      claimIds: ["claim-labora"],
    }],
  });
  input.resume.projects = [{
    name: "Totally Different Project",
    description: "Something nobody can verify.",
    highlights: [],
    link: "",
    claimIds: ["claim-labora"],
  }];
  const found = validateResumeClaims(input).issues.map((i) => i.code);
  assert.ok(
    found.includes("identity_section_unsupported"),
    `the anti-fabrication guarantee must survive the key change, got ${found.join(", ")}`,
  );
});

test("claimIds never reach the rendered document", () => {
  const html = resumeJsonToHtml({
    contact: { name: "A", email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" },
    experience: [],
    education: [],
    projects: [{
      name: "Labora",
      description: "An evidence-grounded resume assurance system.",
      highlights: [],
      link: "",
      claimIds: ["claim-labora"],
    }],
    awards_or_contributions: [{
      title: "Award",
      description: "Recognized for the work.",
      year: "2026",
      link: "",
      claimIds: ["claim-labora"],
    }],
    skills: [],
  });
  assert.ok(html.includes("Labora"), "the project itself must still render");
  assert.ok(!html.includes("claimIds"), "provenance metadata must not render");
  assert.ok(!html.includes("claim-labora"), "a claim id must never appear in the document");
});
