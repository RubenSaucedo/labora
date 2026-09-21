import test from "node:test";
import assert from "node:assert/strict";
import { buildPresentation, DEFAULT_SECTION_ORDER } from "../src/lib/resume-presentation.js";
import { resolveStyleProfile } from "../src/lib/resume-style.js";

const profile = resolveStyleProfile("precision-minimal");

const RESUME = {
  contact: {
    name: "Example Person",
    email: "a@example.test",
    phone: "555-0100",
    github: "https://example.test/gh",
  },
  ats_title: "Engineer",
  summary: "Example summary.",
  skills_primary: ["Go", "Rust"],
  skills_secondary: ["React", "Node.js"],
  experience: [],
  education: [],
  projects: [{
    name: "Example Tool",
    description: "A tool.",
    highlights: [],
    link: "https://example.test/tool",
  }],
  certifications: [{
    name: "Example Credential",
    issuer: "Example Body",
    year: "2025",
    credential_url: "https://example.test/cred",
  }],
  awards_or_contributions: [],
};

test("a credential URL survives the projection", () => {
  const model = buildPresentation(RESUME, { profile });
  assert.equal(model.certifications[0].credentialUrl, "https://example.test/cred");
  assert.equal(model.certifications[0].name, "Example Credential");
});

test("a project link becomes a labelled link, not joined text", () => {
  const model = buildPresentation(RESUME, { profile });
  assert.deepEqual(model.projects[0].link, { label: "Example Tool", url: "https://example.test/tool" });
});

test("contact URLs become link relationships", () => {
  const model = buildPresentation(RESUME, { profile });
  assert.ok(model.links.some((link) => link.url === "https://example.test/gh"));
});

test("skill groups survive instead of flattening to one array", () => {
  const model = buildPresentation(RESUME, { profile });
  assert.equal(model.skillGroups.length, 1);
  assert.deepEqual(model.skillGroups[0].items, ["Go", "Rust", "React", "Node.js"]);
  assert.ok(Array.isArray(model.skillGroups[0].lines));
});

test("a string certification from an older document still parses", () => {
  const model = buildPresentation({ ...RESUME, certifications: ["Legacy Credential"] }, { profile });
  assert.equal(model.certifications[0].name, "Legacy Credential");
  assert.equal(model.certifications[0].credentialUrl, null);
});

test("a missing project link is null rather than an empty-labelled link", () => {
  const model = buildPresentation(
    { ...RESUME, projects: [{ name: "Unlinked", description: "", highlights: [] }] },
    { profile }
  );
  assert.equal(model.projects[0].link, null);
});

test("the default section order is used when the profile declares none", () => {
  const model = buildPresentation(RESUME, { profile });
  assert.deepEqual(model.sectionOrder, DEFAULT_SECTION_ORDER);
});

test("an empty resume projects without throwing", () => {
  const model = buildPresentation({}, { profile });
  assert.deepEqual(model.skillGroups[0].items, []);
  assert.deepEqual(model.links, []);
  assert.deepEqual(model.certifications, []);
});
