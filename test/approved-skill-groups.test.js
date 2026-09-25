import test from "node:test";
import assert from "node:assert/strict";

import {
  agent2ResumeToFormatterJson,
  formatProgression,
  formatResumeToDocxBuffer,
  formatResumeToPdfBuffer,
  resumeJsonToHtml,
  resumeJsonToMarkdown,
} from "../src/agents/format-resume.js";
import { findChrome } from "../src/lib/browser.js";
import { resolveStyleProfile } from "../src/lib/resume-style.js";
import { parsePresentation } from "../src/schemas/resume-presentation.js";
import { validateRenderedArtifact } from "../src/lib/validate-artifact.js";
import { extractTextFromDocx } from "../src/utils/docx-to-text.js";
import { extractTextFromPdf } from "../src/utils/pdf-to-md.js";

const needsBrowser = findChrome() ? false : "no Chromium available";

// Four groups of five, so the grouping also outnumbers the fifteen-skill cap
// the automatic path applies. If an approved skill is silently dropped, these
// fixtures are the ones that notice.
const GROUPS = [
  { label: "Languages", items: ["Go", "Rust", "Python", "TypeScript", "SQL"] },
  { label: "Platform", items: ["Kubernetes", "Docker", "Terraform", "Linux", "Nginx"] },
  { label: "Data", items: ["PostgreSQL", "Redis", "Kafka", "Parquet", "DuckDB"] },
  { label: "Practice", items: ["Code review", "Incident response", "Mentoring", "Profiling", "Fuzzing"] },
];

const APPROVED_SKILLS = GROUPS.flatMap((group) => group.items);

function approvedResume(overrides = {}) {
  return {
    target_role: "Engineer",
    ats_title: "Senior Engineer",
    contact: {
      name: "Example Person",
      email: "person@example.test",
      phone: "+1 555-0100",
      location: "Example City",
      linkedin: "",
      github: "",
      portfolio: "",
    },
    summary: "Engineer with a record of shipping reliable systems.",
    skills_primary: APPROVED_SKILLS.slice(0, 10),
    skills_secondary: APPROVED_SKILLS.slice(10),
    experience: [{
      id: "example-role",
      company: "Example",
      role: "Senior Engineer",
      period: "2020 - Present",
      bullets: ["Reduced request latency across the serving path"],
    }],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
    presentation: { approvedBy: "operator", skillGroups: GROUPS },
    ...overrides,
  };
}

// The job text ranks every approved skill differently from the approved order,
// so any surviving rerank shows up as a reordered group.
const RANKING_JOB = {
  description: "fuzzing duckdb parquet mentoring nginx terraform sql typescript python rust",
};

function projected(overrides) {
  return agent2ResumeToFormatterJson(approvedResume(overrides), { job: RANKING_JOB });
}

function groupedRows(text) {
  const normalized = text.replace(/\*\*/g, "").replace(/\r/g, "");
  return GROUPS.map((group) => {
    const line = normalized
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${group.label}:`));
    return line ?? null;
  });
}

test("an approved grouping survives the projection the formatters actually use", () => {
  const formatter = projected();

  assert.deepEqual(formatter.skillGroups, GROUPS);
  assert.deepEqual(formatter.skills, APPROVED_SKILLS);
  assert.equal(formatter.skills.length, 20, "the fifteen-skill cap must not reach approved groups");
});

test("the approved presentation the fixture relies on is a legal one", () => {
  const parsed = parsePresentation(
    { approvedBy: "operator", skillGroups: GROUPS },
    approvedResume()
  );
  assert.deepEqual(parsed.skillGroups, GROUPS);
});

test("Markdown prints every approved label with its own skills in order", () => {
  const rows = groupedRows(resumeJsonToMarkdown(projected()));
  assert.deepEqual(rows, GROUPS.map((group) => `${group.label}: ${group.items.join(", ")}`));
});

test("HTML prints every approved label with its own skills in order", () => {
  const rows = groupedRows(
    resumeJsonToHtml(projected()).replace(/<[^>]+>/g, (tag) => (tag === "</p>" ? "\n" : ""))
  );
  assert.deepEqual(rows, GROUPS.map((group) => `${group.label}: ${group.items.join(", ")}`));
});

test("DOCX prints every approved label with its own skills in order", async () => {
  const formatter = projected();
  const buffer = await formatResumeToDocxBuffer({ resumeJson: formatter, style: "precision-minimal" });
  const rows = groupedRows(await extractTextFromDocx({ buffer }));
  assert.deepEqual(rows, GROUPS.map((group) => `${group.label}: ${group.items.join(", ")}`));
});

test("PDF prints every approved label with its own skills in order", { skip: needsBrowser }, async () => {
  const formatter = projected();
  const buffer = await formatResumeToPdfBuffer({ resumeJson: formatter, style: "precision-minimal" });
  const { text } = await extractTextFromPdf(buffer);
  const flattened = text.replace(/\s+/g, " ");
  for (const group of GROUPS) {
    assert.ok(
      flattened.includes(`${group.label}: ${group.items.join(", ")}`),
      `${group.label} must survive PDF extraction with its own skills`
    );
  }
  const positions = GROUPS.map((group) => flattened.indexOf(`${group.label}:`));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "group order must survive");
});

test("every approved skill appears exactly once under its own label", () => {
  const printed = groupedRows(resumeJsonToMarkdown(projected()))
    .flatMap((row) => row.split(": ")[1].split(", "));

  // Compared as whole list items, not as substrings: "SQL" occurs inside
  // "PostgreSQL", and a substring count would call that a duplicate.
  assert.deepEqual([...printed].sort(), [...APPROVED_SKILLS].sort());
  assert.equal(new Set(printed).size, APPROVED_SKILLS.length);
});

test("validation refuses a render that flattened the approved grouping", () => {
  const formatter = projected();
  const markdown = resumeJsonToMarkdown(formatter);
  const sectionOrder = resolveStyleProfile("precision-minimal").sectionOrder;

  const grouped = validateRenderedArtifact({
    resume: formatter,
    extractedText: markdown,
    sectionOrder,
  });
  assert.equal(grouped.valid, true);
  assert.equal(grouped.fieldRecallPercent, 100);

  const flattened = markdown.replace(
    groupedRows(markdown).map((row) => `**${row.split(": ")[0]}**: ${row.split(": ")[1]}`).join("\n"),
    APPROVED_SKILLS.join(", ")
  );
  const lost = validateRenderedArtifact({
    resume: formatter,
    extractedText: flattened,
    sectionOrder,
  });
  assert.equal(lost.valid, false);
  assert.notEqual(lost.fieldRecallPercent, 100, "recall must not read 100% once the structure is gone");
  assert.equal(lost.issues.some((issue) => issue.code === "missing_skill_group_label"), true);
});

test("validation refuses a render that reordered the approved groups", () => {
  const formatter = projected();
  const sectionOrder = resolveStyleProfile("precision-minimal").sectionOrder;
  const markdown = resumeJsonToMarkdown(formatter);
  const rows = groupedRows(markdown).map((row) => `**${row.split(": ")[0]}**: ${row.split(": ")[1]}`);
  const swapped = markdown.replace(
    rows.join("\n"),
    [rows[1], rows[0], rows[2], rows[3]].join("\n")
  );

  const result = validateRenderedArtifact({
    resume: formatter,
    extractedText: swapped,
    sectionOrder,
  });
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "skill_group_order"), true);
});

test("without an approved grouping the ranked flat list is still produced", () => {
  const resume = approvedResume();
  delete resume.presentation;
  // maxSkills mirrors the cap every format-* tool passes.
  const formatter = agent2ResumeToFormatterJson(resume, { job: RANKING_JOB, maxSkills: 15 });

  assert.equal(formatter.skillGroups, null);
  assert.equal(formatter.skills.length, 15, "the automatic path still caps the list");
  assert.notDeepEqual(formatter.skills, APPROVED_SKILLS.slice(0, 15), "the automatic path still ranks");
  assert.deepEqual(groupedRows(resumeJsonToMarkdown(formatter)), [null, null, null, null]);
});

test("an unapproved grouping is ignored rather than trusted", () => {
  const resume = approvedResume({ presentation: { skillGroups: GROUPS } });
  const formatter = agent2ResumeToFormatterJson(resume, { job: RANKING_JOB, maxSkills: 15 });

  assert.equal(formatter.skillGroups, null);
  assert.equal(formatter.skills.length, 15);
});

test("progression rendering is retired", () => {
  assert.equal(
    formatProgression(
      [
        { label: "Engineer", date: "2020", disclosure: "public" },
        { label: "Senior Engineer", date: "2023", disclosure: "public" },
      ],
      "Senior Engineer"
    ),
    "",
    "promotions inside one tenure are now ordinary experience text, not a second rendered title line"
  );
});
