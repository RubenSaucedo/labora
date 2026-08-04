import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { skillVocabulary, normalizeSkill } from "../src/lib/skill-vocabulary.js";
import { normalizeIdentity } from "../src/lib/normalize-identity.js";
import { resolvePersonaRoot, personaSearchPaths } from "../src/lib/workspace.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

function generatedPath(persona, file) {
  return path.join(resolvePersonaRoot(persona), "profile", "generated", file);
}

function read(persona, file) {
  return JSON.parse(fs.readFileSync(generatedPath(persona, file), "utf8"));
}

// Only `example` is committed; every other persona is private data living in a
// workspace outside this repo. Tests that assert against a local persona must
// skip when it is absent, or the suite passes only on the machine that happens
// to hold that persona. Resolving through the workspace resolver means they
// still run wherever that persona genuinely is.
function hasPersona(persona) {
  return fs.existsSync(generatedPath(persona, "identity.json"));
}

function shippedPersonas() {
  const seen = new Set();
  for (const root of personaSearchPaths()) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) seen.add(name);
  }
  return [...seen].filter(hasPersona);
}

test("skill labels match their slug form across separators and case", () => {
  const vocabulary = skillVocabulary({
    identity: {},
    bank: { units: [{ id: "u", techStack: ["ci-cd", "performance-engineering", "node.js"] }] },
  });
  assert.ok(vocabulary.has("CI/CD"));
  assert.ok(vocabulary.has("Performance Engineering"));
  assert.ok(vocabulary.has("Node.js"));
  assert.ok(!vocabulary.has("Kubernetes"));
  assert.equal(normalizeSkill("CI/CD"), normalizeSkill("ci-cd"));
});

test("a veto removes a term the bank demonstrates", () => {
  const bank = { units: [{ id: "u", techStack: ["react", "typescript"] }] };
  assert.ok(skillVocabulary({ identity: {}, bank }).has("React"));
  assert.ok(!skillVocabulary({ identity: { skill_vetoes: ["React"] }, bank }).has("React"));
});

test("the vocabulary grows with the bank rather than a hand-written list", () => {
  const before = skillVocabulary({ identity: {}, bank: { units: [{ id: "a", techStack: ["react"] }] } });
  const after = skillVocabulary({
    identity: {},
    bank: { units: [{ id: "a", techStack: ["react"] }, { id: "b", techStack: ["graphql"] }] },
  });
  assert.equal(before.size, 1);
  assert.equal(after.size, 2);
  assert.ok(after.has("GraphQL"));
});

test("a legacy identity record keeps a vocabulary when no bank exists", () => {
  const vocabulary = skillVocabulary({ identity: { legacy_skills: ["React"] }, bank: null });
  assert.ok(vocabulary.has("react"));
  assert.equal(vocabulary.size, 1);
});

test("a real persona's derived vocabulary covers skills the old allowlist blocked", (t) => {
  if (!hasPersona("ruben")) return t.skip("ruben is private data and is not present");
  const vocabulary = skillVocabulary({
    identity: normalizeIdentity(read("ruben", "identity.json")),
    bank: read("ruben", "accomplishments.json"),
  });
  for (const skill of ["Next.js", "PostgreSQL", "WCAG", "Mentoring", "System Design"]) {
    assert.ok(vocabulary.has(skill), `${skill} should be displayable`);
  }
  assert.ok(!vocabulary.has("Kubernetes"), "unproven skills stay blocked");
});

test("normalizeIdentity upgrades a 3.0 document and drops its pre-baked resume", () => {
  const upgraded = normalizeIdentity({
    schema_version: "3.0",
    contact: {
      name: "", email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "",
    },
    summary: "Generic summary that would anchor the tailor.",
    technical_skills: ["React"],
    key_achievements: ["Did a thing."],
    experience: [{ id: "e1", role: "Engineer", company: "Acme", period: "2020", highlights: ["x"] }],
    other_experience_compacted: [],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
  });

  assert.equal(upgraded.schema_version, "4.0");
  assert.equal(upgraded.summary, undefined);
  assert.equal(upgraded.key_achievements, undefined);
  assert.equal(upgraded.technical_skills, undefined);
  assert.equal(upgraded.experience[0].highlights, undefined);
  assert.equal(upgraded.experience[0].id, "e1");
  assert.deepEqual(upgraded.legacy_skills, ["React"]);
});

test("normalizeIdentity passes 4.0 through and rejects unknown versions", () => {
  const identity = read("example", "identity.json");
  assert.equal(normalizeIdentity(identity).schema_version, "4.0");
  assert.throws(() => normalizeIdentity({ schema_version: "2.0" }), /Unsupported identity schema_version/);
});

test("shipped identity records are 4.0 and carry no pre-baked resume", () => {
  for (const persona of shippedPersonas()) {
    const identity = read(persona, "identity.json");
    assert.equal(identity.schema_version, "4.0");
    for (const field of ["summary", "key_achievements", "technical_skills"]) {
      assert.equal(identity[field], undefined, `${persona} identity record must not carry ${field}`);
    }
    for (const entry of identity.experience) {
      assert.equal(entry.highlights, undefined, `${persona} experience must not carry highlights`);
    }
  }
});

test("progression is retained so a long tenure does not read as stagnation", (t) => {
  if (!hasPersona("ruben")) return t.skip("ruben is private data and is not present");
  const identity = read("ruben", "identity.json");
  const microsoft = identity.experience.find((entry) => entry.id === "microsoft-software-engineer-2020");
  assert.equal(microsoft.progression.length, 2);
  for (const step of microsoft.progression) {
    assert.ok(step.claimIds.length, "each progression step must be claim-backed");
    assert.ok(step.externalLabel, "an internal ladder token needs a renderable label");
  }
});

test("a legacy identity record written before schema_version is detected by shape", () => {
  const upgraded = normalizeIdentity({
    contact: {
      name: "", email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "",
    },
    technical_skills: ["React"],
    experience: [{ id: "e1", role: "Engineer", company: "Acme", period: "2020", highlights: ["x"] }],
  });
  assert.equal(upgraded.schema_version, "4.0");
  assert.deepEqual(upgraded.legacy_skills, ["React"]);
  assert.equal(upgraded.experience[0].highlights, undefined);
});
