import test from "node:test";
import assert from "node:assert/strict";

import { formatResumeToPdfBuffer } from "../src/agents/format-resume.js";
import { findChrome } from "../src/lib/browser.js";
import { extractTextFromPdf, isNegligibleText } from "../src/utils/pdf-to-md.js";
import { validateRenderedArtifact } from "../src/lib/validate-artifact.js";

// The PDF renderer needs a real browser. Where there is none the suite says so
// rather than passing quietly, because a skipped check is not a met one.
const chrome = findChrome();
const needsBrowser = chrome ? false : "no Chrome/Chromium on this machine";

// Synthetic throughout: a public repository never carries a real person.
const RESUME = {
  header: {
    name: "Jane Example",
    title: "Platform Engineer",
    location: "Seattle, WA",
    email: "jane@example.test",
    phone: "+1 555-0100",
    linkedin: "linkedin.com/in/jane-example",
    github: "github.com/jane-example",
    portfolio: "jane.example",
  },
  summary: "Platform engineer who measures the render path before changing it.",
  skills: [{ category: "Frontend", items: ["React", "TypeScript"] }],
  experience: [
    {
      company: "Example Systems",
      role: "Platform Engineer",
      location: "Remote",
      startDate: "2021",
      endDate: "Present",
      highlights: [
        "Cut cold start latency by moving the render boundary to the edge",
        "Led the migration of a shared component library used by four teams",
      ],
    },
  ],
  education: [{ institution: "Example University", degree: "BSc Computer Science", year: "2016" }],
  projects: [{ name: "Example Project", link: "https://example.test/project" }],
};

const CONTACT_ROW_ONE = "Seattle, WA | jane@example.test | +1 555-0100";
const CONTACT_ROW_TWO = "linkedin.com/in/jane-example | github.com/jane-example | jane.example";

async function pdfText(style) {
  const buffer = await formatResumeToPdfBuffer({ resumeJson: RESUME, style });
  const { text } = await extractTextFromPdf(buffer);
  return { buffer, text };
}

for (const styleId of ["precision-minimal", "editorial-technical"]) {
  test(
    `${styleId} produces a PDF whose text is real text, not a picture of text`,
    { skip: needsBrowser },
    async () => {
      const { buffer, text } = await pdfText(styleId);

      assert.ok(buffer.subarray(0, 5).toString("latin1") === "%PDF-", "output must be a PDF");
      assert.equal(
        isNegligibleText(text),
        false,
        "an ATS reads the text layer; a scanned image of the page is unreadable to it"
      );
      // A page image would still carry font resources for nothing, so check the
      // extracted characters themselves rather than trusting the container.
      assert.ok(text.includes("Jane Example"));
      assert.ok(text.replace(/\s+/g, " ").includes(CONTACT_ROW_ONE));
      assert.ok(text.replace(/\s+/g, " ").includes(CONTACT_ROW_TWO));
      assert.ok(
        text.includes("Cut cold start latency by moving the render boundary to the edge"),
        "a full bullet must survive extraction unbroken"
      );
    }
  );

  test(
    `${styleId} keeps every renderer-input field recoverable from the PDF`,
    { skip: needsBrowser },
    async () => {
      const { text } = await pdfText(styleId);
      const validation = validateRenderedArtifact({ resume: RESUME, extractedText: text });

      assert.equal(validation.fieldRecallPercent, 100);
      assert.equal(validation.sectionOrderValid, true);
      assert.deepEqual(validation.missingContact, []);
    }
  );

  test(`${styleId} extracts the same text every run`, { skip: needsBrowser }, async () => {
    // PDF bytes carry a creation timestamp, so the guarantee is on what a
    // reader — human or ATS — actually gets out of the file.
    const [first, second] = await Promise.all([pdfText(styleId), pdfText(styleId)]);
    assert.equal(first.text, second.text);
  });
}

test("both profiles print identical words in identical order", { skip: needsBrowser }, async () => {
  const precision = await pdfText("precision-minimal");
  const editorial = await pdfText("editorial-technical");

  const words = (text) => text.replace(/\s+/g, " ").trim();
  assert.equal(words(precision.text), words(editorial.text));
  assert.notEqual(
    precision.buffer.length,
    editorial.buffer.length,
    "a serif display face and different metrics must reach the page"
  );
});

test("an unknown style refuses to reach the browser at all", async () => {
  await assert.rejects(
    () => formatResumeToPdfBuffer({ resumeJson: RESUME, style: "modern" }),
    /Unknown resume style "modern"\. Accepted styles: editorial-technical, precision-minimal\./
  );
});
