import test from "node:test";
import assert from "node:assert/strict";
import { validateRenderedArtifact } from "../src/lib/validate-artifact.js";

const resume = {
  header: { name: "Example Person", email: "a@example.test", phone: "555-0100" },
  summary: "Example summary.",
  skills: ["Go", "Rust"],
  experience: [],
  education: [],
  projects: [{ name: "Example Tool", description: "A tool.", highlights: [], link: null }],
  certifications: [{
    name: "Example Credential",
    issuer: "",
    year: "",
    credentialUrl: null,
    text: "Example Credential",
  }],
};

test("a declared custom order and labels validate instead of failing the order gate", () => {
  const text = "Example Person a@example.test 555-0100 Summary Example summary. "
    + "Open Source & Projects Example Tool A tool. Technical Skills Go, Rust "
    + "Professional Development Example Credential";
  const result = validateRenderedArtifact({
    resume,
    extractedText: text,
    sectionOrder: ["summary", "projects", "skills", "certifications"],
    sectionLabels: {
      summary: "Summary",
      projects: "Open Source & Projects",
      skills: "Technical Skills",
      certifications: "Professional Development",
    },
  });
  assert.equal(result.sectionOrderValid, true);
  assert.deepEqual(result.missingSections, []);
  assert.equal(result.valid, true);
});

test("content out of the declared order still fails", () => {
  const text = "Example Person a@example.test 555-0100 Technical Skills Go, Rust Summary Example summary.";
  const result = validateRenderedArtifact({
    resume,
    extractedText: text,
    sectionOrder: ["summary", "skills"],
    sectionLabels: { summary: "Summary", skills: "Technical Skills" },
  });
  assert.equal(result.sectionOrderValid, false);
});

test("a renamed section that never rendered is still reported missing", () => {
  const text = "Example Person a@example.test 555-0100 Summary Example summary. Technical Skills Go, Rust";
  const result = validateRenderedArtifact({
    resume,
    extractedText: text,
    sectionOrder: ["summary", "skills", "certifications"],
    sectionLabels: {
      summary: "Summary",
      skills: "Technical Skills",
      certifications: "Professional Development",
    },
  });
  assert.deepEqual(result.missingSections, ["Professional Development"]);
  assert.equal(result.valid, false);
});

test("omitting the order keeps the shipped defaults", () => {
  const text = "Example Person a@example.test 555-0100 Summary Example summary. "
    + "Skills Go, Rust Projects Example Tool A tool. Certifications Example Credential";
  const result = validateRenderedArtifact({ resume, extractedText: text });
  assert.equal(result.valid, true);
  assert.equal(result.sectionOrderValid, true);
  assert.equal(result.fieldRecallPercent, 100);
});

test("the order can come from the style profile that produced the artifact", () => {
  const text = "Example Person a@example.test 555-0100 Summary Example summary. "
    + "Projects Example Tool A tool. Skills Go, Rust Certifications Example Credential";
  const viaProfile = validateRenderedArtifact({
    resume,
    extractedText: text,
    profile: { sectionOrder: ["summary", "projects", "skills", "certifications"] },
  });
  assert.equal(viaProfile.sectionOrderValid, true);

  // The same document read against the shipped order is out of sequence, which
  // is what makes the profile the load-bearing input rather than decoration.
  const viaDefault = validateRenderedArtifact({ resume, extractedText: text });
  assert.equal(viaDefault.sectionOrderValid, false);
});

test("an explicit order wins over the profile that rendered the file", () => {
  const text = "Example Person a@example.test 555-0100 Summary Example summary. "
    + "Projects Example Tool A tool. Skills Go, Rust Certifications Example Credential";
  const result = validateRenderedArtifact({
    resume,
    extractedText: text,
    profile: { sectionOrder: ["summary", "skills", "projects", "certifications"] },
    sectionOrder: ["summary", "projects", "skills", "certifications"],
  });
  assert.equal(result.sectionOrderValid, true);
});

test("a section absent from the resume is not expected in the artifact", () => {
  const withoutProjects = { ...resume, projects: [] };
  const text = "Example Person a@example.test 555-0100 Summary Example summary. "
    + "Skills Go, Rust Certifications Example Credential";
  const result = validateRenderedArtifact({ resume: withoutProjects, extractedText: text });
  assert.ok(!result.missingSections.includes("Projects"));
  assert.equal(result.valid, true);
});

test("an approved presentation renders and validates end to end", async () => {
  const { agent2ResumeToFormatterJson, formatResumeToDocxBuffer, resumeJsonToMarkdown } =
    await import("../src/agents/format-resume.js");
  const { extractTextFromDocx } = await import("../src/utils/docx-to-text.js");
  const { resolveStyleProfile } = await import("../src/lib/resume-style.js");

  const tailored = {
    contact: { name: "Example Person", email: "a@example.test", phone: "555-0100" },
    ats_title: "Engineer",
    summary: "Example summary.",
    skills_primary: ["Go", "Rust"],
    skills_secondary: [],
    experience: [],
    education: [],
    projects: [{ name: "Example Tool", description: "A tool.", highlights: [], link: null }],
    certifications: [{ name: "Example Credential", issuer: "", year: "" }],
    awards_or_contributions: [],
    presentation: {
      approvedBy: "operator",
      sectionLabels: { certifications: "Professional Development" },
      skillGroups: [],
    },
  };

  const styleProfile = resolveStyleProfile("precision-minimal");
  const projected = agent2ResumeToFormatterJson(tailored);
  assert.equal(projected.sectionLabels.certifications, "Professional Development");

  const markdown = resumeJsonToMarkdown(projected);
  assert.match(markdown, /## Professional Development/);
  assert.doesNotMatch(markdown, /## Certifications/);

  const buffer = await formatResumeToDocxBuffer({ resumeJson: projected });
  const extracted = await extractTextFromDocx({ buffer });
  assert.match(extracted, /Professional Development/);

  const validation = validateRenderedArtifact({
    resume: projected,
    extractedText: extracted,
    sectionOrder: styleProfile.sectionOrder,
    sectionLabels: projected.sectionLabels,
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.equal(validation.fieldRecallPercent, 100);
});

test("an unapproved presentation block never reaches the page", async () => {
  const { agent2ResumeToFormatterJson, resumeJsonToMarkdown } =
    await import("../src/agents/format-resume.js");

  const projected = agent2ResumeToFormatterJson({
    contact: { name: "Example Person", email: "a@example.test", phone: "555-0100" },
    summary: "Example summary.",
    skills_primary: ["Go"],
    certifications: [{ name: "Example Credential", issuer: "", year: "" }],
    // No approvedBy: an agent proposed this and no human confirmed it.
    presentation: { sectionLabels: { certifications: "Professional Development" } },
  });

  assert.equal(projected.sectionLabels, null);
  assert.match(resumeJsonToMarkdown(projected), /## Certifications/);
});
