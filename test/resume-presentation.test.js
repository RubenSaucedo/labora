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
  const { sectionOrder, ...silentProfile } = profile;
  const model = buildPresentation(RESUME, { profile: silentProfile });
  assert.deepEqual(model.sectionOrder, DEFAULT_SECTION_ORDER);
});

test("a declared profile order overrides the default", () => {
  const model = buildPresentation(RESUME, { profile });
  assert.deepEqual(model.sectionOrder, profile.sectionOrder);
  assert.notDeepEqual(model.sectionOrder, DEFAULT_SECTION_ORDER);
});

test("an empty resume projects without throwing", () => {
  const model = buildPresentation({}, { profile });
  assert.deepEqual(model.skillGroups[0].items, []);
  assert.deepEqual(model.links, []);
  assert.deepEqual(model.certifications, []);
});

test("a profile declares section order and carries no wording", () => {
  const expected = {
    // Projects carry the strongest recent evidence for this profile's readers,
    // so they precede education.
    "precision-minimal": [
      "summary", "experience", "skills", "projects", "education", "certifications", "awards",
    ],
    "editorial-technical": [
      "summary", "experience", "skills", "education", "projects", "certifications", "awards",
    ],
  };
  for (const [id, sectionOrder] of Object.entries(expected)) {
    const styleProfile = resolveStyleProfile(id);
    assert.deepEqual(styleProfile.sectionOrder, sectionOrder);
    assert.equal(styleProfile.sectionLabels, undefined, "labels are words and must not live in a style");
  }
});

test("labels rename sections and may not introduce entities", async () => {
  const { parsePresentation } = await import("../src/schemas/resume-presentation.js");

  const ok = parsePresentation(
    { sectionLabels: { certifications: "Professional Development" }, approvedBy: "operator" },
    RESUME
  );
  assert.equal(ok.sectionLabels.certifications, "Professional Development");

  assert.throws(
    () => parsePresentation(
      { skillGroups: [{ label: "Cloud", items: ["Kubernetes"] }], approvedBy: "operator" },
      RESUME
    ),
    /is not present in the resume/,
    "a skill group may regroup existing skills, never add one"
  );

  assert.throws(
    () => parsePresentation({ sectionLabels: { certifications: "X" } }, RESUME),
    /approvedBy/,
    "an agent-authored label must not render unreviewed"
  );
});

test("a skill may not be printed under two groups", async () => {
  const { parsePresentation } = await import("../src/schemas/resume-presentation.js");
  assert.throws(
    () => parsePresentation({
      approvedBy: "operator",
      skillGroups: [
        { label: "Languages", items: ["Go", "Rust"] },
        { label: "Favourites", items: ["Go"] },
      ],
    }, RESUME),
    /more than one presentation group/
  );
});

test("an approved grouping of real skills passes", async () => {
  const { parsePresentation } = await import("../src/schemas/resume-presentation.js");
  const parsed = parsePresentation({
    approvedBy: "operator",
    skillGroups: [
      { label: "Languages", items: ["Go", "Rust"] },
      { label: "Frontend", items: ["React", "Node.js"] },
    ],
  }, RESUME);
  assert.equal(parsed.skillGroups.length, 2);
  assert.deepEqual(parsed.sectionLabels, {});
});

test("an approved presentation drives grouping and labels through the model", () => {
  const presentation = {
    approvedBy: "operator",
    sectionLabels: { certifications: "Professional Development" },
    skillGroups: [
      { label: "Languages", items: ["Go", "Rust"] },
      { label: "Frontend", items: ["React", "Node.js"] },
    ],
  };
  const model = buildPresentation(RESUME, { profile, presentation });
  assert.equal(model.skillGroups.length, 2);
  assert.equal(model.skillGroups[0].label, "Languages");
  assert.equal(model.sectionLabels.certifications, "Professional Development");
  assert.equal(model.sectionLabels.summary, "Summary", "unnamed sections keep their default label");
});
