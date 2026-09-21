import test from "node:test";
import assert from "node:assert/strict";
import {
  agent2ResumeToFormatterJson,
  formatResumeToDocxBuffer,
  resumeJsonToHtml,
  resumeJsonToMarkdown,
} from "../src/agents/format-resume.js";
import { parseContact, injectContact } from "../src/lib/profile-contact.js";
import { validateRenderedArtifact } from "../src/lib/validate-artifact.js";
import { extractTextFromDocx } from "../src/utils/docx-to-text.js";
import { readDocxPart, readDocxStyleProfileId } from "../src/utils/docx-parts.js";
import { docxStyleTokens, resolveStyleProfile } from "../src/lib/resume-style.js";
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
  const buffer = await formatResumeToDocxBuffer({ resumeJson: formatter, style: "precision-minimal" });
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

test("experience location survives schema, adapter, and every formatter", async () => {
  const resume = tailoredResume();
  resume.experience[0].location = "Austin, TX";
  const parsed = ZTailoredResume.parse(resume);
  const formatter = agent2ResumeToFormatterJson(injectContact(parsed, {
    name: "Jane Example",
    email: "jane@example.com",
    phone: "+1 555-123-4567",
  }));
  const markdown = resumeJsonToMarkdown(formatter);
  const html = resumeJsonToHtml(formatter);
  const docx = await formatResumeToDocxBuffer({ resumeJson: formatter, style: "precision-minimal" });
  const docxText = await extractTextFromDocx({ buffer: docx });

  assert.equal(formatter.experience[0].location, "Austin, TX");
  for (const rendered of [markdown, html, docxText]) {
    assert.match(rendered, /Example \| 2022 - Present \| Austin, TX/);
  }
  assert.equal(
    validateRenderedArtifact({ resume: formatter, extractedText: markdown }).valid,
    true
  );
  const withoutLocation = validateRenderedArtifact({
    resume: formatter,
    extractedText: markdown.replace("Austin, TX", ""),
  });
  assert.equal(withoutLocation.valid, false);
  assert.ok(withoutLocation.missingFields.includes("experience[0].location"));
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

test("renders employer tenure separately from the undated current role", async () => {
  const resume = tailoredResume();
  resume.experience[0] = {
    ...resume.experience[0],
    company: "Example Company",
    role: "Engineer II",
    period: "2019-Present",
  };
  const formatter = agent2ResumeToFormatterJson(injectContact(resume, {
    name: "Jane Example",
    email: "jane@example.com",
    phone: "+1 555-123-4567",
  }));
  const markdown = resumeJsonToMarkdown(formatter);
  const html = resumeJsonToHtml(formatter);
  const docx = await formatResumeToDocxBuffer({ resumeJson: formatter, style: "precision-minimal" });
  const docxText = await extractTextFromDocx({ buffer: docx });

  assert.match(markdown, /### Example Company \| 2019-Present\n\*\*Engineer II\*\*/);
  assert.match(
    html,
    /<p class="sub">Example Company \| 2019-Present<\/p><p class="role-title"><strong>Engineer II<\/strong><\/p>/
  );
  assert.match(docxText, /Example Company \| 2019-Present\s+Engineer II/);

  for (const rendered of [markdown, html, docxText]) {
    assert.doesNotMatch(rendered, /Engineer II at Example Company/);
    assert.doesNotMatch(rendered, /Engineer II \| 2019-Present/);
  }
});

test("all formatter surfaces suppress generic progression unless career jumps are explicit", async () => {
  const resume = tailoredResume();
  resume.experience[0].role = "Senior Engineer";
  resume.experience[0].progression = [
    {
      label: "Internal A",
      externalLabel: "Promoted",
      date: "2020",
      disclosure: "internal_generalizable",
    },
    {
      label: "Internal B",
      externalLabel: "Senior Engineer",
      date: "2022",
      disclosure: "internal_generalizable",
    },
    {
      label: "Internal C",
      externalLabel: "Promoted",
      date: "2023",
      disclosure: "internal_generalizable",
    },
  ];
  const formatter = agent2ResumeToFormatterJson(injectContact(resume, {
    name: "Jane Example",
    email: "jane@example.com",
    phone: "+1 555-123-4567",
  }));
  const markdown = resumeJsonToMarkdown(formatter);
  const html = resumeJsonToHtml(formatter);
  const docx = await formatResumeToDocxBuffer({ resumeJson: formatter, style: "precision-minimal" });
  const docxText = await extractTextFromDocx({ buffer: docx });

  for (const rendered of [markdown, html, docxText]) {
    assert.doesNotMatch(rendered, /Promoted 2020/);
    assert.doesNotMatch(rendered, /Senior Engineer, 2022/);
  }

  formatter.experience[0].progression[0].externalLabelKind = "scope_change";
  formatter.experience[0].progression[2].externalLabelKind = "scope_change";
  assert.match(resumeJsonToMarkdown(formatter), /Promoted twice \(2020, 2023\)/);
});

// ---------------------------------------------------------------------------
// Named style profiles (issue #111): one registry, two renderers, no drift.
//
// Contact values below are synthetic. A public repository never carries a real
// person's details, and a style profile never stores them at all.
// ---------------------------------------------------------------------------

const SYNTHETIC_CONTACT = {
  name: "Jane Example",
  location: "Seattle, WA",
  email: "jane@example.test",
  phone: "+1 555-0100",
  linkedin: "linkedin.com/in/jane-example",
  github: "github.com/jane-example",
  portfolio: "jane.example",
};

const CONTACT_ROW_ONE = "Seattle, WA | jane@example.test | +1 555-0100";
const CONTACT_ROW_TWO = "linkedin.com/in/jane-example | github.com/jane-example | jane.example";

function styledFormatterJson() {
  const resume = tailoredResume();
  // Distinct from the positioning line, so an assertion about the role block
  // cannot accidentally match the header.
  resume.experience[0].role = "Platform Engineer";
  resume.experience[0].bullets = [
    "Built a reliable React application",
    "Cut page load time by measuring the render path",
  ];
  return agent2ResumeToFormatterJson(injectContact(resume, SYNTHETIC_CONTACT));
}

// Relationship IDs for external hyperlinks are generated per render, so the
// comparison masks them rather than pretending the bytes are stable.
function stableDocumentXml(xml) {
  return xml.replace(/rId[A-Za-z0-9_-]{6,}/g, "rIdLINK");
}

for (const styleId of ["precision-minimal", "editorial-technical"]) {
  test(`${styleId} renders both contact rows verbatim in every surface`, async () => {
    const formatter = styledFormatterJson();
    const docxText = await extractTextFromDocx({
      buffer: await formatResumeToDocxBuffer({ resumeJson: formatter, style: styleId }),
    });
    const html = resumeJsonToHtml(formatter, styleId);
    const markdown = resumeJsonToMarkdown(formatter, styleId);

    assert.match(docxText, new RegExp(`${CONTACT_ROW_ONE.replace(/[|+]/g, "\\$&")}`));
    assert.match(docxText, new RegExp(CONTACT_ROW_TWO.replace(/[|]/g, "\\|")));
    // Rows are separate paragraphs, so the grouping survives instead of
    // depending on where the measure happens to run out.
    assert.ok(
      docxText.indexOf(CONTACT_ROW_ONE) < docxText.indexOf(CONTACT_ROW_TWO),
      "location/email/phone precede the link row"
    );
    assert.match(
      html,
      /<p class="contact">Seattle, WA \| <a href="mailto:jane@example\.test">jane@example\.test<\/a> \| \+1 555-0100<\/p>/
    );
    assert.match(
      html,
      /<p class="contact"><a href="https:\/\/linkedin\.com\/in\/jane-example">linkedin\.com\/in\/jane-example<\/a> \| <a href="https:\/\/github\.com\/jane-example">github\.com\/jane-example<\/a> \| <a href="https:\/\/jane\.example">jane\.example<\/a><\/p>/
    );
    assert.ok(markdown.includes(`${CONTACT_ROW_ONE}  \n${CONTACT_ROW_TWO}`));
  });

  test(`${styleId} keeps every renderer-input field recoverable in order`, async () => {
    const formatter = styledFormatterJson();
    const buffer = await formatResumeToDocxBuffer({ resumeJson: formatter, style: styleId });
    const validation = validateRenderedArtifact({
      resume: formatter,
      extractedText: await extractTextFromDocx({ buffer }),
    });

    assert.equal(validation.valid, true);
    assert.equal(validation.fieldRecallPercent, 100);
    assert.equal(validation.sectionOrderValid, true);
    assert.deepEqual(validation.missingContact, []);
  });

  test(`${styleId} carries hyperlinks and an underline into the DOCX`, async () => {
    const buffer = await formatResumeToDocxBuffer({
      resumeJson: styledFormatterJson(),
      style: styleId,
    });
    const relationships = readDocxPart(buffer, "word/_rels/document.xml.rels");
    const document = readDocxPart(buffer, "word/document.xml");
    const accent = docxStyleTokens(styleId).colors.accent;

    for (const target of [
      "mailto:jane@example.test",
      "https://linkedin.com/in/jane-example",
      "https://github.com/jane-example",
      "https://jane.example",
      "https://example.com/project",
    ]) {
      assert.ok(
        relationships.includes(`Target="${target}" TargetMode="External"`),
        `${target} must survive as a real hyperlink`
      );
    }
    assert.match(document, /<w:hyperlink/);
    // Underlined, not merely coloured: colour alone disappears in greyscale.
    assert.match(document, /<w:u w:val="single"\/>/);
    assert.ok(document.includes(`<w:color w:val="${accent}"/>`));
    assert.ok(
      !/Seattle, WA<\/w:t>[\s\S]{0,200}<w:hyperlink/.test(document),
      "a location is not a destination and must not be linked"
    );
  });

  test(`${styleId} keeps headings with their sections and bullets whole`, async () => {
    const buffer = await formatResumeToDocxBuffer({
      resumeJson: styledFormatterJson(),
      style: styleId,
    });
    const document = readDocxPart(buffer, "word/document.xml");
    const paragraphs = document.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? [];
    const withText = (text) => paragraphs.filter((paragraph) => paragraph.includes(`>${text}<`));

    for (const heading of ["Summary", "Experience", "Skills", "Education"]) {
      const [paragraph] = withText(heading);
      assert.ok(paragraph, `${heading} heading must exist`);
      assert.match(paragraph, /<w:keepNext\/>/, `${heading} must keep with the section it opens`);
    }
    const [role] = withText("Platform Engineer");
    assert.match(role, /<w:keepNext\/>/, "a role heading must keep with its bullets");
    assert.match(role, /<w:keepLines\/>/, "a role block must not split mid-line");
    for (const bullet of withText("Built a reliable React application")) {
      assert.match(bullet, /<w:keepLines\/>/, "a bullet must not split across pages");
    }

    const html = resumeJsonToHtml(styledFormatterJson(), styleId);
    assert.match(html, /\.section \{[^}]*break-after: avoid;/);
    assert.match(html, /\.role-head \{[^}]*break-inside: avoid;/);
    assert.match(html, /li \{[^}]*break-inside: avoid;/);
  });

  test(`${styleId} records itself in the artifact it produced`, async () => {
    const buffer = await formatResumeToDocxBuffer({
      resumeJson: styledFormatterJson(),
      style: styleId,
    });
    assert.equal(readDocxStyleProfileId({ buffer }), styleId);
    assert.match(
      readDocxPart(buffer, "docProps/core.xml"),
      new RegExp(`Labora resume style profile: ${styleId}`)
    );
    assert.match(
      resumeJsonToHtml(styledFormatterJson(), styleId),
      new RegExp(`<meta name="labora-style-profile" content="${styleId}">`)
    );
  });

  test(`${styleId} renders the same document twice`, async () => {
    const formatter = styledFormatterJson();
    const [first, second] = await Promise.all([
      formatResumeToDocxBuffer({ resumeJson: formatter, style: styleId }),
      formatResumeToDocxBuffer({ resumeJson: formatter, style: styleId }),
    ]);

    assert.equal(
      stableDocumentXml(readDocxPart(first, "word/document.xml")),
      stableDocumentXml(readDocxPart(second, "word/document.xml"))
    );
    assert.equal(
      await extractTextFromDocx({ buffer: first }),
      await extractTextFromDocx({ buffer: second })
    );
    assert.equal(
      resumeJsonToHtml(formatter, styleId),
      resumeJsonToHtml(formatter, styleId)
    );
    assert.equal(
      resumeJsonToMarkdown(formatter, styleId),
      resumeJsonToMarkdown(formatter, styleId)
    );
  });
}

test("the two profiles differ visually while printing identical content", async () => {
  const formatter = styledFormatterJson();
  const precision = await formatResumeToDocxBuffer({
    resumeJson: formatter,
    style: "precision-minimal",
  });
  const editorial = await formatResumeToDocxBuffer({
    resumeJson: formatter,
    style: "editorial-technical",
  });

  // A style decides how the page looks. It may never decide what it says.
  assert.equal(
    await extractTextFromDocx({ buffer: precision }),
    await extractTextFromDocx({ buffer: editorial })
  );
  const precisionXml = readDocxPart(precision, "word/document.xml");
  const editorialXml = readDocxPart(editorial, "word/document.xml");
  assert.notEqual(precisionXml, editorialXml);
  assert.ok(editorialXml.includes('w:ascii="Georgia"'), "serif display face reaches the DOCX");
  assert.ok(!precisionXml.includes('w:ascii="Georgia"'));

  assert.equal(
    resumeJsonToMarkdown(formatter, "precision-minimal"),
    resumeJsonToMarkdown(formatter, "editorial-technical"),
    "the review companion has no typography to differ in"
  );
});

test("an unknown style never renders a document", async () => {
  const formatter = styledFormatterJson();
  await assert.rejects(
    () => formatResumeToDocxBuffer({ resumeJson: formatter, style: 1 }),
    /Unknown resume style "1"\. Accepted styles: editorial-technical, precision-minimal\./
  );
  assert.throws(
    () => resumeJsonToHtml(formatter, "modern"),
    /Unknown resume style "modern"/
  );
});

test("a malformed style profile is refused before anything is rendered", async () => {
  const broken = { ...resolveStyleProfile("precision-minimal"), colors: undefined };
  await assert.rejects(
    () => formatResumeToDocxBuffer({ resumeJson: styledFormatterJson(), style: broken }),
    /Invalid resume style profile/
  );
});

// Regression for the reported 7 / 7 / 1 skills layout. The three renderers used
// to chunk skills independently by item count, so a fifteenth skill was
// stranded on its own line in every format at once.
const FIFTEEN_SKILL_RESUME = {
  header: { name: "Example Person", title: "Engineer", email: "person@example.test", phone: "555-0100" },
  summary: "Example summary.",
  skills: [
    "TypeScript", "Concurrency", "Graceful Degradation", "Observability",
    "Agent Orchestration", "Agent Evaluation", "Asynchronous Workflows",
    "JavaScript", "Node.js", "AI Agents", "Model Context Protocol", "React",
    "Next.js", "Angular", "Fastify",
  ],
  experience: [], education: [], projects: [], certifications: [],
};

test("HTML and Markdown agree on skill grouping, and neither orphans a skill", () => {
  const html = resumeJsonToHtml(FIFTEEN_SKILL_RESUME);
  const htmlLines = [...html.matchAll(/<p class="skills">([^<]*)<\/p>/g)].map((match) => match[1]);
  assert.equal(htmlLines.length, 3);
  assert.ok(
    Math.min(...htmlLines.map((line) => line.split(", ").length)) >= 2,
    `HTML produced ${htmlLines.map((l) => l.split(", ").length).join("/")}`
  );
  assert.ok(!htmlLines.includes("Fastify"), "the fifteenth skill must not be stranded alone");

  const markdown = resumeJsonToMarkdown(FIFTEEN_SKILL_RESUME);
  for (const line of htmlLines) {
    assert.ok(markdown.includes(line), `Markdown must group skills identically to HTML: ${line}`);
  }
});

test("the DOCX groups skills identically to HTML, which is what renderer parity means", async () => {
  const buffer = await formatResumeToDocxBuffer({ resumeJson: FIFTEEN_SKILL_RESUME });
  const text = await extractTextFromDocx({ buffer });
  const htmlLines = [...resumeJsonToHtml(FIFTEEN_SKILL_RESUME).matchAll(/<p class="skills">([^<]*)<\/p>/g)]
    .map((match) => match[1]);
  for (const line of htmlLines) {
    assert.ok(text.includes(line), `DOCX must carry the same skill line: ${line}`);
  }
});

test("skill grouping is identical across repeated renders", () => {
  assert.equal(resumeJsonToHtml(FIFTEEN_SKILL_RESUME), resumeJsonToHtml(FIFTEEN_SKILL_RESUME));
});
