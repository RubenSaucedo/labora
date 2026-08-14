import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { agent2ResumeToFormatterJson, resumeJsonToMarkdown } from "../src/agents/format-resume.js";
import { validateResumeClaims } from "../src/lib/validate-resume-claims.js";

function fixture() {
  const personaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "summary-narrative-"));
  const sourcePath = path.join(personaRoot, "profile", "career.md");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, [
    "Full-Stack Engineer — Example Systems (2018 - Present)",
    "Full-stack engineer with 8 years of experience across React and Node.js, spanning browser and server application delivery.",
    "Owned the design and rollout of an agent orchestration capability that automated support workflows.",
    "Delivered a separate migration milestone for the deployment pipeline.",
    "Built DevTrace, a public developer tool for inspecting API traces.",
  ].join("\n"));
  const fileHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
  const source = (lineStart, lineEnd = lineStart) => ({
    path: "profile/career.md",
    fileHash,
    lineStart,
    lineEnd,
  });

  const identity = {
    experience: [{
      id: "example-full-stack",
      company: "Example Systems",
      role: "Full-Stack Engineer",
      period: "2018 - Present",
      progression: [],
    }],
    other_experience_compacted: [],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
    skill_vetoes: [],
  };
  const ledger = {
    claims: [
      {
        id: "claim-identity",
        type: "identity",
        fact: "Full-stack engineer with 8 years of experience across React and Node.js, spanning browser and server application delivery.",
        status: "verified",
        disclosure: "public",
        sources: [source(1, 2)],
      },
      {
        id: "claim-agent",
        type: "achievement",
        fact: "Owned the design and rollout of an agent orchestration capability that automated support workflows.",
        status: "verified",
        disclosure: "public",
        sources: [source(3)],
      },
      {
        id: "claim-delivery",
        type: "achievement",
        fact: "Delivered a separate migration milestone for the deployment pipeline.",
        status: "verified",
        disclosure: "public",
        sources: [source(4)],
      },
      {
        id: "claim-tool",
        type: "project",
        fact: "Built DevTrace, a public developer tool for inspecting API traces.",
        status: "verified",
        disclosure: "public",
        sources: [source(5)],
      },
    ],
  };
  const bank = {
    units: [
      {
        id: "unit-full-stack",
        experienceId: "example-full-stack",
        contribution: "major_contributor",
        techStack: ["React", "Node.js"],
        claimIds: ["claim-identity"],
      },
      {
        id: "unit-agent",
        experienceId: "example-full-stack",
        contribution: "sole_owner",
        techStack: ["Workflow automation"],
        claimIds: ["claim-agent"],
      },
      {
        id: "unit-delivery",
        experienceId: "example-full-stack",
        contribution: "major_contributor",
        techStack: ["Delivery pipelines"],
        claimIds: ["claim-delivery"],
      },
      {
        id: "unit-tool",
        experienceId: "example-full-stack",
        contribution: "sole_owner",
        techStack: ["API tooling"],
        claimIds: ["claim-tool"],
      },
    ],
  };
  const applicationStrategy = {
    firstPagePlan: {
      summaryPlan: {
        identity: {
          engineerType: "Product-minded full-stack engineer",
          anchor: "8 years of experience",
          scope: "Browser and server application delivery with React and Node.js",
          claimIds: ["claim-identity"],
          unitIds: ["unit-full-stack"],
        },
        recentProof: {
          accomplishment: "Agent orchestration capability",
          contributionLevel: "sole_owner",
          concreteContext: "Owned design and rollout that automated support workflows",
          claimIds: ["claim-agent"],
          primaryUnitId: "unit-agent",
        },
        differentiator: {
          focus: "Public developer tool for API trace inspection",
          claimIds: ["claim-tool"],
          unitIds: ["unit-tool"],
        },
      },
    },
  };
  const summary = [
    "Product-minded full-stack engineer with 8 years of experience across React and Node.js, spanning browser and server application delivery.",
    "Owned the design and rollout of an agent orchestration capability that automated support workflows.",
    "Built DevTrace, a public developer tool for inspecting API traces.",
  ].join(" ");
  const resume = {
    target_role: "Software Engineer",
    ats_title: "Software Engineer",
    summary,
    skills_primary: ["React", "Node.js", "Workflow automation", "API tooling"],
    skills_secondary: [],
    experience: [{
      id: "example-full-stack",
      company: "Example Systems",
      role: "Full-Stack Engineer",
      period: "2018 - Present",
      progression: [],
      bullets: [],
    }],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
    provenance: {
      summaryClaimIds: [],
      summary: [
        {
          sentenceIndex: 0,
          text: "Product-minded full-stack engineer with 8 years of experience across React and Node.js, spanning browser and server application delivery.",
          clauses: [{
            text: "Product-minded full-stack engineer with 8 years of experience across React and Node.js, spanning browser and server application delivery.",
            claimIds: ["claim-identity"],
            unitIds: ["unit-full-stack"],
          }],
        },
        {
          sentenceIndex: 1,
          text: "Owned the design and rollout of an agent orchestration capability that automated support workflows.",
          clauses: [{
            text: "Owned the design and rollout of an agent orchestration capability that automated support workflows.",
            claimIds: ["claim-agent"],
            unitIds: ["unit-agent"],
          }],
        },
        {
          sentenceIndex: 2,
          text: "Built DevTrace, a public developer tool for inspecting API traces.",
          clauses: [{
            text: "Built DevTrace, a public developer tool for inspecting API traces.",
            claimIds: ["claim-tool"],
            unitIds: ["unit-tool"],
          }],
        },
      ],
      bullets: [],
      skills: [
        { skill: "React", claimIds: ["claim-identity"] },
        { skill: "Node.js", claimIds: ["claim-identity"] },
        { skill: "Workflow automation", claimIds: ["claim-agent"] },
        { skill: "API tooling", claimIds: ["claim-tool"] },
      ],
      headline: [],
    },
  };
  return { resume, identity, ledger, bank, applicationStrategy, personaRoot };
}

function validate(input) {
  return validateResumeClaims({
    ...input,
    workspaceRoot: input.personaRoot,
  });
}

function replaceSentence(input, index, text, claimIds, unitIds) {
  const sentences = input.resume.provenance.summary.map((entry) => entry.text);
  sentences[index] = text;
  input.resume.summary = sentences.join(" ");
  input.resume.provenance.summary[index] = {
    sentenceIndex: index,
    text,
    clauses: [{ text, claimIds, unitIds }],
  };
}

test("renders identity, concrete proof, and differentiator instead of a capability list", () => {
  const input = fixture();
  const result = validate(input);
  assert.equal(result.valid, true, JSON.stringify(result.issues));

  const markdown = resumeJsonToMarkdown(agent2ResumeToFormatterJson({
    ...input.resume,
    contact: {
      name: "Example Person",
      email: "example@example.com",
      phone: "+1 555-0100",
      location: "",
      linkedin: "",
      github: "",
      portfolio: "",
    },
  }));
  const identityIndex = markdown.indexOf("Product-minded full-stack engineer");
  const proofIndex = markdown.indexOf("Owned the design and rollout");
  const differentiatorIndex = markdown.indexOf("Built DevTrace");
  assert.ok(identityIndex < proofIndex && proofIndex < differentiatorIndex);
});

test("rejects a comma-linked capability inventory", () => {
  const input = fixture();
  replaceSentence(
    input,
    0,
    "Full-stack engineer with React, Node.js, workflow automation, API tooling, and agent systems.",
    ["claim-identity", "claim-agent", "claim-tool"],
    ["unit-full-stack", "unit-agent", "unit-tool"]
  );
  const result = validate(input);
  assert.ok(result.issues.some((entry) => entry.code === "summary_capability_inventory"));
  assert.ok(result.issues.some((entry) => entry.code === "summary_restates_skills"));
});

test("rejects a summary without an engineering identity or concrete owned proof", () => {
  const input = fixture();
  replaceSentence(
    input,
    0,
    "Product-minded technologist with 8 years of experience across React and Node.js, spanning browser and server application delivery.",
    ["claim-identity"],
    ["unit-full-stack"]
  );
  replaceSentence(
    input,
    1,
    "Experience includes an agent orchestration capability for support workflows.",
    ["claim-agent"],
    ["unit-agent"]
  );
  const result = validate(input);
  assert.ok(result.issues.some((entry) => entry.code === "summary_identity_missing"));
  assert.ok(result.issues.some((entry) => entry.code === "summary_concrete_proof_missing"));
});

test("rejects omission of a selected differentiator", () => {
  const input = fixture();
  input.resume.summary = input.resume.provenance.summary.slice(0, 2).map((entry) => entry.text).join(" ");
  input.resume.provenance.summary = input.resume.provenance.summary.slice(0, 2);
  const result = validate(input);
  assert.ok(result.issues.some((entry) => entry.code === "summary_differentiator_plan_mismatch"));
});

test("rejects a material clause that lacks direct claim support", () => {
  const input = fixture();
  replaceSentence(
    input,
    1,
    "Owned the design and rollout of an agent orchestration capability serving 2 million users.",
    ["claim-agent"],
    ["unit-agent"]
  );
  const result = validate(input);
  assert.ok(result.issues.some((entry) => entry.code === "summary_claim_mismatch"));
});

test("rejects a lifecycle assembled from separate accomplishment units", () => {
  const input = fixture();
  replaceSentence(
    input,
    1,
    "Owned agent orchestration from design through delivery of a migration milestone.",
    ["claim-agent", "claim-delivery"],
    ["unit-agent", "unit-delivery"]
  );
  const result = validate(input);
  assert.ok(result.issues.some((entry) => entry.code === "summary_unit_lifecycle_merge"));
});

test("requires accomplishment claims to carry their clause-level unit provenance", () => {
  const input = fixture();
  replaceSentence(
    input,
    1,
    "Owned agent orchestration and delivered a separate migration milestone.",
    ["claim-agent", "claim-delivery"],
    ["unit-agent"]
  );
  const result = validate(input);
  assert.ok(result.issues.some((entry) => entry.code === "summary_claim_unit_unmapped"));
});

test("rejects headline repetition, generic gerund openings, and unverified seniority", () => {
  const cases = [
    [
      "Software Engineer with 8 years of experience across React and Node.js, spanning browser and server application delivery.",
      "summary_repeats_headline",
    ],
    [
      "Full-stack engineer building browser and server applications with React and Node.js.",
      "summary_generic_gerund_opener",
    ],
    [
      "Senior full-stack engineer with 8 years of experience across React and Node.js, spanning browser and server application delivery.",
      "summary_unverified_seniority",
    ],
  ];
  for (const [text, code] of cases) {
    const input = fixture();
    replaceSentence(input, 0, text, ["claim-identity"], ["unit-full-stack"]);
    const result = validate(input);
    assert.ok(result.issues.some((entry) => entry.code === code), `${code}: ${JSON.stringify(result.issues)}`);
  }
});

test("rejects weak ownership phrasing when the selected unit supports ownership", () => {
  const input = fixture();
  replaceSentence(
    input,
    1,
    "Hands-on work in agent orchestration for support workflows.",
    ["claim-agent"],
    ["unit-agent"]
  );
  const result = validate(input);
  assert.ok(result.issues.some((entry) => entry.code === "summary_weak_ownership_phrase"));
});

test("flags internal jargon that survives a generalized claim", () => {
  const input = fixture();
  const sourcePath = path.join(input.personaRoot, "profile", "career.md");
  const lines = fs.readFileSync(sourcePath, "utf8").split("\n");
  lines[2] = "Owned ProjectBluebird, an agent orchestration capability that automated support workflows.";
  fs.writeFileSync(sourcePath, lines.join("\n"));
  const fileHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
  for (const claim of input.ledger.claims) {
    for (const source of claim.sources) source.fileHash = fileHash;
  }
  const claim = input.ledger.claims.find((entry) => entry.id === "claim-agent");
  claim.fact = lines[2];
  claim.disclosure = "internal_generalizable";
  claim.externalFact = lines[2];
  replaceSentence(
    input,
    1,
    "Owned ProjectBluebird, an agent orchestration capability that automated support workflows.",
    ["claim-agent"],
    ["unit-agent"]
  );
  const result = validate(input);
  assert.ok(result.issues.some((entry) => entry.code === "summary_internal_jargon"));
});

test("flags unsupported summary language with specific diagnostics", () => {
  const cases = [
    ["Led an agent orchestration capability for support workflows.", "summary_unsupported_leadership"],
    ["Launched an agent orchestration capability for support workflows.", "summary_unsupported_completion"],
    ["Maintains an agent orchestration capability for support workflows.", "summary_unsupported_maintenance"],
    ["Owned durable runtime semantics for support workflows.", "summary_unsupported_durable_runtime"],
    ["Owned agent orchestration capabilities for support workflows.", "summary_unsupported_plural_artifact"],
  ];
  for (const [text, code] of cases) {
    const input = fixture();
    replaceSentence(input, 1, text, ["claim-agent"], ["unit-agent"]);
    const result = validate(input);
    assert.ok(result.issues.some((entry) => entry.code === code), `${code}: ${JSON.stringify(result.issues)}`);
  }
});
