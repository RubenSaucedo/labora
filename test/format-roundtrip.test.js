import test from "node:test";
import assert from "node:assert/strict";
import {
  agent2ResumeToFormatterJson,
  formatResumeToDocxBuffer,
  resumeJsonToMarkdown,
} from "../src/agents/format-resume.js";
import { parseContact, injectContact } from "../src/lib/profile-contact.js";
import { validateRenderedArtifact } from "../src/lib/validate-artifact.js";
import { extractTextFromDocx } from "../src/utils/docx-to-text.js";
import { ZTailoredResume } from "../src/schemas/tailored-resume.js";

function tailoredResume() {
  return {
    target_role: "Engineer",
    ats_title: "Engineer",
    contact: {
      name: "",
      email: "",
      phone: "",
      location: "",
      linkedin: "",
      github: "",
      portfolio: "",
    },
    summary: "Engineer with a record of shipping reliable systems.",
    skills_primary: ["React"],
    skills_secondary: [],
    experience: [{
      id: "example-role",
      company: "Example",
      role: "Engineer",
      period: "2022 - Present",
      bullets: ["Built a reliable React application"],
    }],
    education: [{
      school: "Example University",
      degree: "BS Computer Science",
      location: "Seattle, WA",
      startDate: "2014",
      endDate: "2018",
    }],
    projects: [{
      name: "Project One",
      description: "A useful project",
      highlights: [],
      link: "https://example.com/project",
    }],
    certifications: [{ name: "Cloud Certificate", issuer: "Example", year: "2025" }],
    awards_or_contributions: [],
    keywords_mapped: [{
      keyword: "secret-keyword",
      evidence: "internal-only",
    }],
  };
}

test("injects contact and preserves fields through DOCX round trip", async () => {
  const contact = parseContact(`## Engineer data
- Name: Jane Example
- Phone: +1 555-123-4567
- Email: jane@example.com
- Address: Seattle, WA
- Web: https://jane.example.test`);
  const resume = injectContact(tailoredResume(), contact);
  const formatter = agent2ResumeToFormatterJson(resume);
  const buffer = await formatResumeToDocxBuffer({ resumeJson: formatter, style: 1 });
  const text = await extractTextFromDocx({ buffer });
  const validation = validateRenderedArtifact({ resume: formatter, extractedText: text });

  assert.equal(validation.valid, true);
  assert.match(text, /Jane Example/);
  assert.match(text, /Seattle, WA/);
  assert.match(text, /https:\/\/jane\.example\.test/);
  assert.match(text, /https:\/\/example.com\/project/);
  assert.match(text, /Cloud Certificate, Example, 2025/);
  assert.doesNotMatch(text, /secret-keyword/);
  assert.equal(validation.fieldRecallScope, "renderer_input");

  const withoutPortfolio = validateRenderedArtifact({
    resume: formatter,
    extractedText: text.replace("https://jane.example.test", ""),
  });
  assert.equal(withoutPortfolio.valid, false);
  assert.equal(withoutPortfolio.missingFields.includes("header.portfolio"), true);
});

test("renders a deterministic Markdown review companion without internal metadata", () => {
  const contact = parseContact(`## Engineer data
- Name: Jane Example
- Phone: +1 555-123-4567
- Email: jane@example.com
- Address: Seattle, WA
- Web: https://jane.example.test`);
  const formatter = agent2ResumeToFormatterJson(injectContact(tailoredResume(), contact));
  const first = resumeJsonToMarkdown(formatter);
  const second = resumeJsonToMarkdown(formatter);
  const validation = validateRenderedArtifact({ resume: formatter, extractedText: first });

  assert.equal(first, second);
  assert.equal(validation.valid, true);
  assert.equal(validation.fieldRecallPercent, 100);
  assert.match(first, /^<!-- Labora review companion\./);
  assert.match(first, /# Jane Example/);
  assert.match(first, /https:\/\/jane\.example\.test/);
  assert.match(first, /- Built a reliable React application/);
  assert.doesNotMatch(first, /secret-keyword/);
  assert.doesNotMatch(first, /keywords_mapped/);
});

test("escapes active Markdown and HTML from dynamic resume text", () => {
  const resume = tailoredResume();
  resume.summary = "Built [systems](https://example.invalid) and <img src=x> safely.";
  resume.experience[0].bullets = ["![remote](https://example.invalid/pixel)"];
  const formatter = agent2ResumeToFormatterJson(injectContact(resume, {
    name: "Jane Example",
    email: "jane@example.com",
    phone: "+1 555-123-4567",
  }));
  const markdown = resumeJsonToMarkdown(formatter);
  const validation = validateRenderedArtifact({ resume: formatter, extractedText: markdown });

  assert.equal(validation.valid, true);
  assert.doesNotMatch(markdown, /!\[remote\]/);
  assert.doesNotMatch(markdown, /(^|[^\\])<img/);
  assert.match(markdown, /!\\\[remote\\\]/);
  assert.match(markdown, /\\<img src=x\\>/);
});

test("fails when a rendered project, skill, or certification is missing", () => {
  const formatter = agent2ResumeToFormatterJson(injectContact(tailoredResume(), {
    name: "Jane Example",
    email: "jane@example.com",
    phone: "+1 555-123-4567",
  }));
  const result = validateRenderedArtifact({
    resume: formatter,
    extractedText: "Jane Example Engineer Summary Engineer with a record of shipping reliable systems. Experience Example Engineer 2022 - Present Built a reliable React application Education Example University BS Computer Science",
  });
  assert.equal(result.valid, false);
  assert.equal(result.missingSections.includes("Skills"), true);
  assert.equal(result.missingSections.includes("Projects"), true);
  assert.equal(result.missingSections.includes("Certifications"), true);
});

test("contact injection requires complete private context", () => {
  assert.throws(
    () => injectContact(tailoredResume(), { name: "Jane", email: "jane@example.com" }),
    /missing required contact fields/
  );
});

test("persisted tailored resumes cannot contain contact data", () => {
  const resume = tailoredResume();
  resume.contact.email = "persisted@example.com";
  assert.equal(ZTailoredResume.safeParse(resume).success, false);
});

test("requires every duplicate rendered field occurrence", () => {
  const formatter = agent2ResumeToFormatterJson(injectContact(tailoredResume(), {
    name: "Jane Example",
    email: "jane@example.com",
    phone: "+1 555-123-4567",
  }));
  formatter.experience[0].highlights.push("Built a reliable React application");
  const result = validateRenderedArtifact({
    resume: formatter,
    extractedText: "Jane Example jane@example.com +1 555-123-4567 Engineer Summary Engineer with a record of shipping reliable systems. Experience Example Engineer 2022 - Present Built a reliable React application Skills React Education Example University BS Computer Science 2014 2018 Seattle WA Projects Project One A useful project https://example.com/project Certifications Cloud Certificate Example 2025",
  });
  assert.equal(result.valid, false);
  assert.equal(result.missingFields.some((field) => field.includes("highlights[1]")), true);
});
