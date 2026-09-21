import test from "node:test";
import assert from "node:assert/strict";
import {
  resumeJsonToHtml,
  resumeJsonToMarkdown,
  agent2ResumeToFormatterJson,
  formatResumeToDocxBuffer,
} from "../src/agents/format-resume.js";
import { validateRenderedArtifact } from "../src/lib/validate-artifact.js";

const RESUME = {
  contact: { name: "Example Person", email: "a@example.test", phone: "555-0100" },
  ats_title: "Engineer",
  summary: "Example summary.",
  skills_primary: ["Go", "Rust"],
  skills_secondary: [],
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

test("HTML emits anchors for the project and the credential", () => {
  const html = resumeJsonToHtml(agent2ResumeToFormatterJson(RESUME));
  assert.match(html, /<a href="https:\/\/example\.test\/tool"/);
  assert.match(html, /<a href="https:\/\/example\.test\/cred"/);
});

test("Markdown emits link syntax, not bare URLs", () => {
  const markdown = resumeJsonToMarkdown(agent2ResumeToFormatterJson(RESUME));
  assert.match(markdown, /\]\(https:\/\/example\.test\/tool\)/);
  assert.match(markdown, /\[Example Credential[^\]]*\]\(https:\/\/example\.test\/cred\)/);
});

test("the credential URL is no longer discarded by the projection", () => {
  const projected = agent2ResumeToFormatterJson(RESUME);
  assert.equal(projected.certifications[0].credentialUrl, "https://example.test/cred");
  assert.equal(projected.certifications[0].text, "Example Credential, Example Body, 2025");
});

test("a certification without a URL still renders as plain text", () => {
  const resume = { ...RESUME, certifications: [{ name: "Unlinked Credential", issuer: "", year: "2024" }] };
  const html = resumeJsonToHtml(agent2ResumeToFormatterJson(resume));
  const markdown = resumeJsonToMarkdown(agent2ResumeToFormatterJson(resume));
  assert.match(html, /Unlinked Credential, 2024/);
  assert.ok(!/Unlinked Credential[^<]*<a /.test(html), "no anchor without a URL");
  assert.match(markdown, /- Unlinked Credential, 2024/);
});

test("a string certification from an older document still renders everywhere", () => {
  const resume = { ...RESUME, certifications: ["Legacy Credential"] };
  const projected = agent2ResumeToFormatterJson(resume);
  assert.equal(projected.certifications[0].credentialUrl, null);
  assert.match(resumeJsonToHtml(projected), /Legacy Credential/);
  assert.match(resumeJsonToMarkdown(projected), /- Legacy Credential/);
});

test("the DOCX carries external hyperlink relationships", async () => {
  const mammoth = (await import("mammoth")).default;
  const buffer = await formatResumeToDocxBuffer({ resumeJson: agent2ResumeToFormatterJson(RESUME) });
  // Reading the package back through a Word-compatible converter proves the
  // relationship exists, which scanning the zip bytes cannot: the rels part is
  // compressed, so a raw byte search reports absence for a link that is there.
  const { value: html } = await mammoth.convertToHtml({ buffer });
  assert.match(html, /<a href="https:\/\/example\.test\/cred"/);
  assert.match(html, /<a href="https:\/\/example\.test\/tool"/);
});

test("a dropped credential link fails validation even though the name renders", () => {
  const projected = agent2ResumeToFormatterJson(RESUME);
  const markdown = resumeJsonToMarkdown(projected);

  const withLinks = validateRenderedArtifact({
    resume: projected,
    extractedText: markdown,
    linkTargets: ["https://example.test/tool", "https://example.test/cred"],
  });
  assert.equal(withLinks.valid, true);
  assert.deepEqual(withLinks.missingLinkTargets, []);

  // Same words, same recall — the only difference is that the renderer never
  // made the credential clickable.
  const withoutLinks = validateRenderedArtifact({
    resume: projected,
    extractedText: markdown,
    linkTargets: ["https://example.test/tool"],
  });
  assert.equal(withoutLinks.fieldRecallPercent, withLinks.fieldRecallPercent);
  assert.equal(withoutLinks.valid, false);
  assert.ok(withoutLinks.issues.some((issue) => issue.code === "missing_link_target"));
  assert.deepEqual(withoutLinks.missingLinkTargets, ["certifications[0].credentialUrl"]);
});

test("a caller that cannot read relationships is not penalised", () => {
  const projected = agent2ResumeToFormatterJson(RESUME);
  // linkTargets omitted on purpose: a caller that cannot enumerate
  // relationships must not have its silence read as absence.
  const validation = validateRenderedArtifact({
    resume: projected,
    extractedText: resumeJsonToMarkdown(projected),
  });
  assert.deepEqual(validation.missingLinkTargets, []);
  assert.ok(!validation.issues.some((issue) => issue.code === "missing_link_target"));
});

test("the extractor the validator uses recovers the rendered targets", async () => {
  const { extractLinkTargetsFromDocx } = await import("../src/utils/docx-to-text.js");
  const projected = agent2ResumeToFormatterJson(RESUME);
  const buffer = await formatResumeToDocxBuffer({ resumeJson: projected });
  const targets = await extractLinkTargetsFromDocx({ buffer });

  assert.deepEqual(targets.sort(), ["https://example.test/cred", "https://example.test/tool"]);
  // mailto: is contact rendering, already covered by field recall; counting it
  // here would make the link check disagree with what it claims to measure.
  assert.ok(!targets.some((url) => url.startsWith("mailto:")));

  const validation = validateRenderedArtifact({
    resume: projected,
    extractedText: await (await import("../src/utils/docx-to-text.js")).extractTextFromDocx({ buffer }),
    linkTargets: targets,
  });
  assert.deepEqual(validation.missingLinkTargets, []);
});
