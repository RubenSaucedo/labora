import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import fs from "fs/promises";
import { balanceSkillLines } from "../lib/skill-layout.js";
import {
  normalizeCertification,
  approvedSkillGroups,
  flattenSkillGroups,
  DEFAULT_SECTION_ORDER,
  DEFAULT_SECTION_LABELS,
} from "../lib/resume-presentation.js";
import {
  DEFAULT_STYLE_ID,
  contactRows,
  cssStyleTokens,
  docxStyleTokens,
  linkHref,
  resolveStyleProfile,
} from "../lib/resume-style.js";
import { parseResumeStyleProfile } from "../schemas/resume-style.js";

// Every render resolves its style through here, so an invalid profile is caught
// before a single paragraph exists rather than showing up as a wrong-looking
// page nobody can trace.
function renderStyle(style) {
  return parseResumeStyleProfile(resolveStyleProfile(style ?? DEFAULT_STYLE_ID));
}

/**
 * Resolve the section sequence and the heading words for one render.
 *
 * Order comes from the style profile because rearranging sections invents no
 * words. Labels come from the document, because they are words, and a style
 * may not put words on a page. Both fall back to the shipped defaults, so a
 * resume written before either existed renders exactly as it did.
 */
function sectionPlan(profile, resumeJson) {
  const labels = { ...DEFAULT_SECTION_LABELS, ...(resumeJson?.sectionLabels ?? {}) };
  return {
    order: profile?.sectionOrder ?? DEFAULT_SECTION_ORDER,
    labelFor: (key) => labels[key] ?? DEFAULT_SECTION_LABELS[key] ?? key,
  };
}

/**
 * Resume Formatter (JSON -> DOCX)
 *
 * Responsibilities:
 * - Take already-final resume JSON and produce an ATS-friendly DOCX.
 * - Must NOT change, rewrite, summarize, or invent content.
 * - Only map JSON fields into a clean structure.
 *
 * Output:
 * - Returns a Buffer (DOCX bytes).
 * - Optional helper to save to disk.
 */

// Style comes from the named registry in src/lib/resume-style.js. The renderers
// hold no visual constants of their own: both this DOCX writer and the HTML
// writer below read tokens derived from the same validated profile, so a style
// cannot mean one thing in Word and another in print.

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function safeJoin(parts, sep = " | ") {
  return parts.filter(isNonEmptyString).join(sep);
}

function experienceCompanyLine(exp, dateSeparator = " – ") {
  const dates = safeJoin([exp?.startDate, exp?.endDate], dateSeparator);
  return safeJoin([exp?.company, dates, exp?.location], " | ");
}

// Progression is useful only when its external wording tells a reader what
// changed. Shared analysis applies disclosure, conservative lexical filtering,
// heading de-duplication, and the optional verified scope-change override.
// Promotions inside one tenure are written as ordinary experience entries now.
// The old path carried a structured `progression` array that existed to be
// claim-gated, and rendering it meant a second place where a job title could
// disagree with the one above it.
export function formatProgression() {
  return "";
}

/**
 * Expected JSON shape (flexible but recommended):
 * {
 *  header: {
 *    name: string,
 *    title?: string,
 *    location?: string,
 *    email?: string,
 *    phone?: string,
 *    linkedin?: string,
 *    github?: string,
 *    portfolio?: string
 *  },
 *  summary?: string,
 *  skills?: {
 *    languages?: string[],
 *    frameworks?: string[],
 *    tools?: string[],
 *    platforms?: string[],
 *    other?: string[]
 *  } | string[] | string,
 *  experience?: Array<{
 *    company: string,
 *    role: string,
 *    location?: string,
 *    startDate?: string, // employer-tenure start or complete period
 *    endDate?: string,   // employer-tenure end
 *    highlights?: string[]
 *  }>,
 *  projects?: Array<{
 *    name: string,
 *    description?: string,
 *    highlights?: string[]
 *  }>,
 *  education?: Array<{
 *    school: string,
 *    degree?: string,
 *    field?: string,
 *    startDate?: string,
 *    endDate?: string
 *  }>,
 *  certifications?: string[],
 *  awards_or_contributions?: Array<{ title: string, description?: string, year?: string, link?: string }>
 * }
 */

function bodyRun(tokens, options) {
  return new TextRun({ font: tokens.fontBody, color: tokens.colors.body, ...options });
}

function displayRun(tokens, options) {
  return new TextRun({ font: tokens.fontDisplay, color: tokens.colors.heading, ...options });
}

// A link has to survive as a link, and has to look like one without depending on
// colour: greyscale print and colour-blind readers both lose a hue-only cue, so
// the underline carries the affordance and the accent colour only reinforces it.
function linkRun(tokens, { text, href, size }) {
  const child = new TextRun({
    text,
    font: tokens.fontBody,
    size,
    color: tokens.colors.accent,
    underline: tokens.links.underline ? {} : undefined,
  });
  return new ExternalHyperlink({ children: [child], link: href });
}

function buildHeading(tokens, text) {
  return new Paragraph({
    children: [displayRun(tokens, { text, bold: true, size: tokens.sizes.section })],
    heading: HeadingLevel.HEADING_2,
    // w:keepNext. A section heading alone at the foot of a page reads to a human
    // as a section with nothing in it.
    keepNext: tokens.pagination.headingKeepWithNext,
    spacing: { before: tokens.spacing.section, after: tokens.spacing.paragraph },
    border: tokens.sectionRule.enabled
      ? {
        bottom: {
          style: BorderStyle.SINGLE,
          size: tokens.sectionRule.size,
          color: tokens.sectionRule.color,
          space: 2,
        },
      }
      : undefined,
  });
}

function buildSubheading(tokens, text) {
  return new Paragraph({
    children: [displayRun(tokens, { text, bold: true, size: tokens.sizes.role })],
    keepNext: tokens.pagination.roleKeepWithNext,
    keepLines: tokens.pagination.roleBlockKeepTogether,
    spacing: { before: tokens.spacing.role, after: 0 },
  });
}

function buildBodyLine(tokens, text, { after } = {}) {
  return new Paragraph({
    children: [bodyRun(tokens, { text, size: tokens.sizes.body })],
    spacing: { before: 0, after: after ?? tokens.spacing.paragraph },
  });
}

/**
 * One approved skill group: a bold label, then its skills in approved order.
 *
 * Two runs rather than one so the label reads as a heading to a human, while
 * text extraction still yields "Label: a, b, c" — the same string the Markdown
 * and HTML paths produce, which is what lets one validation check cover all
 * three formats.
 */
function buildLabelledSkillLine(tokens, row) {
  return new Paragraph({
    children: [
      displayRun(tokens, { text: `${row.label}: `, bold: true, size: tokens.sizes.body }),
      bodyRun(tokens, { text: row.items.join(", "), size: tokens.sizes.body }),
    ],
    spacing: { before: 0, after: tokens.spacing.skill },
  });
}

function buildMetadataLine(tokens, text, { keepNext = false } = {}) {  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: tokens.fontBody,
        size: tokens.sizes.metadata,
        color: tokens.colors.muted,
        italics: true,
      }),
    ],
    keepNext,
    spacing: { before: 0, after: tokens.spacing.paragraph },
  });
}

function buildRoleLine(tokens, text) {
  return new Paragraph({
    children: [bodyRun(tokens, { text, bold: true, size: tokens.sizes.body })],
    // Kept with the bullets beneath it: a title separated from its own
    // accomplishments is a formatting artifact that looks like missing content.
    keepNext: tokens.pagination.roleKeepWithNext,
    keepLines: tokens.pagination.roleBlockKeepTogether,
    spacing: { before: 0, after: tokens.spacing.paragraph },
  });
}

function buildBullet(tokens, text) {
  return new Paragraph({
    children: [bodyRun(tokens, { text, size: tokens.sizes.body })],
    bullet: { level: 0 },
    // w:keepLines. A bullet split across a page break usually separates the work
    // from its measured outcome.
    keepLines: tokens.pagination.bulletKeepTogether,
    spacing: { before: 0, after: tokens.spacing.bullet },
  });
}

// Deterministic contact rows: grouping comes from the style profile, not from
// wherever the measure happens to run out.
function buildContactRows(tokens, header) {
  const rows = contactRows(header, tokens.id);
  return rows.map((row, rowIndex) => {
    const children = [];
    for (const [index, item] of row.entries()) {
      if (index > 0) {
        children.push(
          new TextRun({
            text: " | ",
            font: tokens.fontBody,
            size: tokens.sizes.metadata,
            color: tokens.colors.muted,
          })
        );
      }
      children.push(
        item.href
          ? linkRun(tokens, { text: item.text, href: item.href, size: tokens.sizes.metadata })
          : new TextRun({
            text: item.text,
            font: tokens.fontBody,
            size: tokens.sizes.metadata,
            color: tokens.colors.muted,
          })
      );
    }
    return new Paragraph({
      children,
      spacing: {
        before: 0,
        after: rowIndex === rows.length - 1 ? tokens.spacing.section : 0,
      },
    });
  });
}

function normalizeSkills(skills) {
  // Accept object, array, or string. Return array of "Category: a, b, c" lines.
  if (!skills) return [];

  if (typeof skills === "string") {
    return [skills.trim()].filter(Boolean);
  }

  if (Array.isArray(skills)) {
    return skills.map(s => String(s).trim()).filter(Boolean);
  }

  if (typeof skills === "object") {
    const lines = [];
    for (const [k, v] of Object.entries(skills)) {
      if (!v) continue;
      const label = k
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, c => c.toUpperCase())
        .trim();

      const arr = Array.isArray(v) ? v : [v];
      const cleaned = arr.map(x => String(x).trim()).filter(Boolean);
      if (cleaned.length) {
        lines.push(`${label}: ${cleaned.join(", ")}`);
      }
    }
    return lines;
  }

  return [];
}

/**
 * Group skills into balanced comma-separated lines.
 *
 * Partitioning lives in src/lib/skill-layout.js so the DOCX, HTML and Markdown
 * paths cannot drift: all three call this, and this calls one shared function.
 * Chunking by item count is what produced the reported 7 / 7 / 1 layout, where
 * the fifteenth skill rendered alone on its own line.
 */
function formatSkillsForDisplay(skills, maxPerLine = 7) {
  return balanceSkillLines(normalizeSkills(skills), { maxPerLine });
}

/**
 * The skill rows to print, as `{ label, items, text }`.
 *
 * One helper for all three renderers, so an approved grouping cannot render in
 * Markdown and be flattened in DOCX. An approved group keeps its label, its
 * membership and its order and is never re-partitioned; without one the rows
 * are the automatic width-balanced lines and carry no label.
 */
function skillRowsForDisplay(resumeJson, maxPerLine = 7) {
  const groups = Array.isArray(resumeJson?.skillGroups) ? resumeJson.skillGroups : null;
  if (groups && groups.length) {
    return groups
      .map((group) => ({
        label: String(group?.label ?? "").trim(),
        items: (Array.isArray(group?.items) ? group.items : []).map((item) => String(item).trim()),
      }))
      .filter((group) => group.label && group.items.length)
      .map((group) => ({ ...group, text: `${group.label}: ${group.items.join(", ")}` }));
  }
  return formatSkillsForDisplay(resumeJson?.skills, maxPerLine)
    .map((line) => ({ label: "", items: [], text: line }));
}

/** Tokenize text to lowercase alphanumeric tokens. */
function tokenize(text) {
  if (typeof text !== "string") return [];
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

/**
 * Return top maxSkills from combined skills_primary + skills_secondary, ordered by relevance to job description.
 * JD phrase match = 10; per-token overlap = 1. Preserves original order for ties (primary first).
 */
function topSkillsByRelevance(skills, jobDescription, maxSkills) {
  if (!Array.isArray(skills) || skills.length === 0 || maxSkills == null || maxSkills < 1) return skills;
  const jd = (jobDescription || "").toLowerCase();
  const jdTokens = new Set(tokenize(jd));
  const scored = skills.map((s, index) => {
    const str = String(s).trim();
    if (!str) return { str, score: 0, index };
    const skillLower = str.toLowerCase();
    if (jd.includes(skillLower)) return { str, score: 10, index };
    const tokens = tokenize(str);
    let score = 0;
    for (const t of tokens) {
      if (jdTokens.has(t)) score += 1;
    }
    return { str, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, maxSkills).map((x) => x.str);
}

// ---- HTML template for PDF (same section order, ATS-safe, single column) ----
function escapeHtml(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build ATS-safe HTML from the same resume JSON used for DOCX.
 * Single column, standard font, no tables for layout.
 *
 * The text stays real text: no canvas, no images of words, no layout tables.
 * That is what keeps the printed PDF selectable, searchable, and extractable by
 * the parsers that read it before a human does.
 *
 * @param {object} resumeJson - Formatter JSON (header, summary, skills, experience, etc.)
 * @param {string|object} [style] - Style profile ID, or a resolved profile.
 */
export function resumeJsonToHtml(resumeJson, style = DEFAULT_STYLE_ID) {
  if (!resumeJson || typeof resumeJson !== "object") return "";

  const profile = renderStyle(style);
  const tokens = cssStyleTokens(profile);
  const { order: sectionOrder, labelFor } = sectionPlan(profile, resumeJson);
  const {
    header = {},
    summary,
    skills,
    experience = [],
    projects = [],
    education = [],
    certifications = [],
    awards_or_contributions = []
  } = resumeJson;

  const skillRows = skillRowsForDisplay(resumeJson, profile.layout.maxSkillsPerLine);
  const parts = [];

  const sectionBorder = tokens.sectionRule.enabled
    ? `border-bottom: ${tokens.sectionRule.border}; padding-bottom: 2px;`
    : "";

  const link = (text, href) => (href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
    : escapeHtml(text));

  parts.push(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Resume</title>`);
  // The style profile travels with the document it produced, so a rendered page
  // can be traced back to the visual contract it was reviewed under.
  parts.push(`<meta name="labora-style-profile" content="${escapeHtml(tokens.id)}">`);
  parts.push(`<style>
:root {
  --labora-style: "${tokens.id}";
  --font-body: ${tokens.fontBody};
  --font-display: ${tokens.fontDisplay};
  --color-body: ${tokens.colors.body};
  --color-heading: ${tokens.colors.heading};
  --color-muted: ${tokens.colors.muted};
  --color-accent: ${tokens.colors.accent};
  --color-name: ${tokens.colors.name};
  --color-rule: ${tokens.colors.rule};
}
@page { size: Letter; margin: ${tokens.margin}; }
body {
  font-family: var(--font-body);
  font-size: ${tokens.sizes.body};
  line-height: ${tokens.lineHeight};
  color: var(--color-body);
  margin: 0;
  text-align: left;
}
@media screen { body { margin: ${tokens.margin}; } }
h1 {
  font-family: var(--font-display);
  font-size: ${tokens.sizes.name};
  color: var(--color-name);
  font-weight: 700;
  margin: 0 0 ${tokens.spacing.paragraph} 0;
}
.positioning {
  font-size: ${tokens.sizes.positioning};
  font-weight: ${tokens.positioning.weight};
  font-style: ${tokens.positioning.style};
  color: var(--color-heading);
  margin: 0 0 ${tokens.spacing.paragraph} 0;
}
.contact {
  font-size: ${tokens.sizes.metadata};
  color: var(--color-muted);
  margin: 0;
}
.contact + .contact { margin-top: 2px; }
.contact:last-of-type { margin-bottom: ${tokens.spacing.section}; }
.section {
  font-family: var(--font-display);
  font-size: ${tokens.sizes.section};
  color: var(--color-heading);
  font-weight: 700;
  margin: ${tokens.spacing.section} 0 ${tokens.spacing.paragraph} 0;
  ${sectionBorder}
  break-after: avoid;
  page-break-after: avoid;
}
.role { margin: 0 0 ${tokens.spacing.role} 0; }
.role-head {
  break-inside: avoid;
  page-break-inside: avoid;
  break-after: avoid;
  page-break-after: avoid;
}
.sub {
  font-family: var(--font-display);
  font-size: ${tokens.sizes.role};
  color: var(--color-heading);
  font-weight: 700;
  margin: ${tokens.spacing.role} 0 0 0;
}
.role-title { font-weight: 700; margin: 0 0 ${tokens.spacing.paragraph} 0; }
.meta {
  font-size: ${tokens.sizes.metadata};
  font-style: italic;
  color: var(--color-muted);
  margin: 0 0 ${tokens.spacing.paragraph} 0;
}
.skills { margin: 0 0 ${tokens.spacing.skill} 0; }
p, ul { margin: 0 0 ${tokens.spacing.paragraph} 0; }
ul { padding-left: 18px; }
li {
  margin: 0 0 ${tokens.spacing.bullet} 0;
  break-inside: avoid;
  page-break-inside: avoid;
}
/* Colour alone is not a link affordance: it vanishes in greyscale print. */
a { color: var(--color-accent); text-decoration: underline; }
</style></head><body>`);

  if (isNonEmptyString(header.name)) {
    parts.push(`<h1>${escapeHtml(header.name.trim())}</h1>`);
  }
  if (isNonEmptyString(header.title)) {
    parts.push(`<p class="positioning">${escapeHtml(header.title.trim())}</p>`);
  }
  for (const row of contactRows(header, tokens.id)) {
    parts.push(
      `<p class="contact">${row.map((item) => link(item.text, item.href)).join(" | ")}</p>`
    );
  }

  // Each section is an emitter rather than a statement in a fixed sequence, so
  // the order below is data. A section the resume does not have emits nothing;
  // it is never rendered as an empty heading.
  const emitters = {
    summary: () => {
      if (!isNonEmptyString(summary)) return;
      parts.push(`<p class="section">${escapeHtml(labelFor("summary"))}</p><p>${escapeHtml(summary.trim())}</p>`);
    },
    experience: () => {
      if (!Array.isArray(experience) || !experience.length) return;
      parts.push(`<p class="section">${escapeHtml(labelFor("experience"))}</p>`);
      for (const exp of experience) {
        const role = exp?.role ?? "";
        const companyLine = experienceCompanyLine(exp);
        const progressionLine = formatProgression(exp?.progression, role);
        parts.push(`<div class="role"><div class="role-head">`);
        if (isNonEmptyString(companyLine)) parts.push(`<p class="sub">${escapeHtml(companyLine)}</p>`);
        if (isNonEmptyString(role)) {
          parts.push(`<p class="role-title"><strong>${escapeHtml(role.trim())}</strong></p>`);
        }
        if (progressionLine) parts.push(`<p class="meta">${escapeHtml(progressionLine)}</p>`);
        parts.push(`</div>`);
        const highlights = Array.isArray(exp?.highlights) ? exp.highlights : [];
        if (highlights.length) {
          parts.push("<ul>");
          for (const h of highlights) {
            if (isNonEmptyString(h)) parts.push(`<li>${escapeHtml(h.trim())}</li>`);
          }
          parts.push("</ul>");
        }
        parts.push(`</div>`);
      }
    },
    skills: () => {
      if (!skillRows.length) return;
      parts.push(`<p class="section">${escapeHtml(labelFor("skills"))}</p>`);
      for (const row of skillRows) {
        parts.push(row.label
          ? `<p class="skills"><strong>${escapeHtml(row.label)}</strong>: ${escapeHtml(row.items.join(", "))}</p>`
          : `<p class="skills">${escapeHtml(row.text)}</p>`);
      }
    },
    education: () => {
      if (!Array.isArray(education) || !education.length) return;
      parts.push(`<p class="section">${escapeHtml(labelFor("education"))}</p>`);
      for (const ed of education) {
        const school = ed?.school ?? "";
        const degree = ed?.degree ?? "";
        const field = ed?.field ?? "";
        const dates = safeJoin([ed?.startDate, ed?.endDate], " \u2013 ");
        const sub = safeJoin([school, safeJoin([degree, field], ", "), dates, ed?.location], " | ");
        if (isNonEmptyString(sub)) parts.push(`<p class="sub">${escapeHtml(sub)}</p>`);
      }
    },
    projects: () => {
      if (!Array.isArray(projects) || !projects.length) return;
      parts.push(`<p class="section">${escapeHtml(labelFor("projects"))}</p>`);
      for (const p of projects) {
        const name = p?.name ?? "";
        const desc = p?.description ?? "";
        const label = isNonEmptyString(name) ? name.trim() : "Project";
        const projectLink = isNonEmptyString(p?.link)
          ? ` | ${link(p.link.trim(), linkHref(p.link))}`
          : "";
        parts.push(`<p class="sub">${escapeHtml(label)}${projectLink}</p>`);
        if (isNonEmptyString(desc)) parts.push(`<p>${escapeHtml(desc.trim())}</p>`);
        const highlights = Array.isArray(p?.highlights) ? p.highlights : [];
        for (const h of highlights) {
          if (isNonEmptyString(h)) parts.push(`<p>${escapeHtml(h.trim())}</p>`);
        }
      }
    },
    certifications: () => {
      if (!Array.isArray(certifications) || !certifications.length) return;
      parts.push(`<p class="section">${escapeHtml(labelFor("certifications"))}</p>`);
      for (const c of certifications) {
        const cert = normalizeCertification(c);
        if (!isNonEmptyString(cert.text)) continue;
        // A credential the reader cannot open is a claim they cannot check, so
        // the URL is a real anchor rather than text appended to the name.
        parts.push(`<p>${link(cert.text, linkHref(cert.credentialUrl ?? ""))}</p>`);
      }
    },
    awards: () => {
      if (!Array.isArray(awards_or_contributions) || !awards_or_contributions.length) return;
      parts.push(`<p class="section">${escapeHtml(labelFor("awards"))}</p>`);
      for (const a of awards_or_contributions) {
        const title = (a && typeof a === "object" ? a.title : String(a)) ?? "";
        if (!isNonEmptyString(title)) continue;
        const desc = (a && typeof a === "object" ? a.description : "") ?? "";
        const year = (a && typeof a === "object" ? a.year : "") ?? "";
        const awardLink = (a && typeof a === "object" ? a.link : "") ?? "";
        const line = [title, desc, year, awardLink].filter(isNonEmptyString).join(" \u2014 ");
        parts.push(`<p>${escapeHtml(line)}</p>`);
      }
    },
  };
  for (const key of sectionOrder) emitters[key]?.();

  parts.push("</body></html>");
  return parts.join("");
}

/**
 * Build a readable Markdown review companion from the same formatter JSON used
 * for DOCX and PDF. This is not a delivery artifact or a source of claims.
 *
 * @param {object} resumeJson
 * @param {string|object} [style] - Only the contact-row grouping is style-driven;
 *   Markdown has no typography to carry.
 */
export function resumeJsonToMarkdown(resumeJson, style = DEFAULT_STYLE_ID) {
  if (!resumeJson || typeof resumeJson !== "object") return "";

  const markdownProfile = renderStyle(style);
  const { order: sectionOrder, labelFor } = sectionPlan(markdownProfile, resumeJson);
  const markdownText = (value) => String(value ?? "")
    .replace(/([\\`*_[\]<>&])/g, "\\$1")
    .replace(/^(\s*)([#>+-]|\d+\.)\s/gm, "$1\\$2 ");
  const {
    header = {},
    summary,
    skills,
    experience = [],
    projects = [],
    education = [],
    certifications = [],
    awards_or_contributions = []
  } = resumeJson;

  const lines = [
    "<!-- Labora review copy. Edit it freely; " +
      "fold anything you want to keep back into resume.json before you render again. -->",
  ];
  const blank = () => {
    if (lines.at(-1) !== "") lines.push("");
  };
  const section = (name) => {
    blank();
    lines.push(`## ${name}`, "");
  };

  if (isNonEmptyString(header.name)) lines.push(`# ${markdownText(header.name.trim())}`);
  if (isNonEmptyString(header.title)) {
    blank();
    lines.push(`*${markdownText(header.title.trim())}*`);
  }
  const contactLines = contactRows(header, style).map((row) =>
    row.map((item) => markdownText(item.text)).join(" | ")
  );
  if (contactLines.length) {
    blank();
    // Two lines, not one wrapped line: the review companion shows the same
    // grouping the delivery artifacts print.
    lines.push(contactLines.join("  \n"));
  }

  const skillRows = skillRowsForDisplay(resumeJson, markdownProfile.layout.maxSkillsPerLine);
  const emitters = {
    summary: () => {
      if (!isNonEmptyString(summary)) return;
      section(labelFor("summary"));
      lines.push(markdownText(summary.trim()));
    },
    experience: () => {
      if (!Array.isArray(experience) || !experience.length) return;
      section(labelFor("experience"));
      for (const exp of experience) {
        const role = exp?.role ?? "";
        const companyLine = experienceCompanyLine(exp, " - ");
        if (isNonEmptyString(companyLine)) lines.push(`### ${markdownText(companyLine)}`);
        if (isNonEmptyString(role)) lines.push(`**${markdownText(role.trim())}**`);
        const progressionLine = formatProgression(exp?.progression, role);
        if (progressionLine) lines.push(`*${markdownText(progressionLine)}*`);
        const highlights = Array.isArray(exp?.highlights) ? exp.highlights : [];
        for (const highlight of highlights) {
          if (isNonEmptyString(highlight)) lines.push(`- ${markdownText(highlight.trim())}`);
        }
        blank();
      }
    },
    skills: () => {
      if (!skillRows.length) return;
      section(labelFor("skills"));
      for (const row of skillRows) {
        lines.push(row.label
          ? `**${markdownText(row.label)}**: ${markdownText(row.items.join(", "))}`
          : markdownText(row.text));
      }
    },
    education: () => {
      if (!Array.isArray(education) || !education.length) return;
      section(labelFor("education"));
      for (const entry of education) {
        const heading = safeJoin([entry?.school, safeJoin([entry?.degree, entry?.field], ", ")], " | ");
        if (isNonEmptyString(heading)) lines.push(`### ${markdownText(heading)}`);
        const details = safeJoin([
          safeJoin([entry?.startDate, entry?.endDate], " - "),
          entry?.location
        ], " | ");
        if (isNonEmptyString(details)) lines.push(markdownText(details));
        blank();
      }
    },
    projects: () => {
      if (!Array.isArray(projects) || !projects.length) return;
      section(labelFor("projects"));
      for (const project of projects) {
        const name = isNonEmptyString(project?.name) ? project.name.trim() : "Project";
        const href = linkHref(project?.link ?? "");
        const heading = href
          ? `${markdownText(name)} | [${markdownText(project.link.trim())}](${href})`
          : markdownText(safeJoin([name, project?.link], " | "));
        lines.push(`### ${heading}`);
        if (isNonEmptyString(project?.description)) lines.push(markdownText(project.description.trim()));
        const highlights = Array.isArray(project?.highlights) ? project.highlights : [];
        for (const highlight of highlights) {
          if (isNonEmptyString(highlight)) lines.push(`- ${markdownText(highlight.trim())}`);
        }
        blank();
      }
    },
    certifications: () => {
      if (!Array.isArray(certifications) || !certifications.length) return;
      section(labelFor("certifications"));
      for (const certification of certifications) {
        const cert = normalizeCertification(certification);
        if (!isNonEmptyString(cert.text)) continue;
        const href = linkHref(cert.credentialUrl ?? "");
        lines.push(href
          ? `- [${markdownText(cert.text)}](${href})`
          : `- ${markdownText(cert.text)}`);
      }
    },
    awards: () => {
      if (!Array.isArray(awards_or_contributions) || !awards_or_contributions.length) return;
      section(labelFor("awards"));
      for (const award of awards_or_contributions) {
        const title = (award && typeof award === "object" ? award.title : String(award)) ?? "";
        if (!isNonEmptyString(title)) continue;
        const description = (award && typeof award === "object" ? award.description : "") ?? "";
        const year = (award && typeof award === "object" ? award.year : "") ?? "";
        const awardLink = (award && typeof award === "object" ? award.link : "") ?? "";
        lines.push(`- ${markdownText(
          [title, description, year, awardLink].filter(isNonEmptyString).join(" - ")
        )}`);
      }
    },
  };
  for (const key of sectionOrder) emitters[key]?.();

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function formatResumeToDocxBuffer({
  resumeJson,
  outputPath,
  style: styleParam
}) {
  if (!resumeJson || typeof resumeJson !== "object") {
    throw new Error("resumeJson object is required");
  }

  const profile = renderStyle(styleParam);
  const tokens = docxStyleTokens(profile);
  const { order: sectionOrder, labelFor } = sectionPlan(profile, resumeJson);
  const {
    header = {},
    summary,
    skills,
    experience = [],
    projects = [],
    education = [],
    certifications = [],
    awards_or_contributions = []
  } = resumeJson;

  const docChildren = [];

  // ---- Header: name, positioning line, deterministic contact rows ----
  if (isNonEmptyString(header.name)) {
    docChildren.push(
      new Paragraph({
        children: [
          displayRun(tokens, {
            text: header.name.trim(),
            bold: true,
            size: tokens.sizes.name,
            color: tokens.colors.name,
          }),
        ],
        keepNext: true,
        spacing: { after: tokens.spacing.paragraph },
      })
    );
  }
  if (isNonEmptyString(header.title)) {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: header.title.trim(),
            font: tokens.fontBody,
            size: tokens.sizes.positioning,
            color: tokens.colors.heading,
            bold: tokens.positioning.bold,
            italics: tokens.positioning.italics,
          }),
        ],
        keepNext: true,
        spacing: { after: tokens.spacing.paragraph },
      })
    );
  }
  docChildren.push(...buildContactRows(tokens, header));

  // Same emitter-per-section shape as the HTML and Markdown renderers, so the
  // three cannot drift apart on which sections exist or what order they take.
  const emitters = {
    summary: () => {
      if (isNonEmptyString(summary)) {
        docChildren.push(buildHeading(tokens, labelFor("summary")));
        docChildren.push(buildBodyLine(tokens, summary.trim()));
      }
    },
    experience: () => {
      if (Array.isArray(experience) && experience.length) {
        docChildren.push(buildHeading(tokens, labelFor("experience")));
        for (const exp of experience) {
          const role = exp?.role ?? "";
          const companyLine = experienceCompanyLine(exp);
          if (isNonEmptyString(companyLine)) docChildren.push(buildSubheading(tokens, companyLine));
          if (isNonEmptyString(role)) docChildren.push(buildRoleLine(tokens, role.trim()));
          const progressionLine = formatProgression(exp?.progression, role);
          if (progressionLine) {
            docChildren.push(buildMetadataLine(tokens, progressionLine, {
              keepNext: tokens.pagination.roleKeepWithNext,
            }));
          }
          const highlights = Array.isArray(exp?.highlights) ? exp.highlights : [];
          for (const h of highlights) {
            if (isNonEmptyString(h)) docChildren.push(buildBullet(tokens, h.trim()));
          }
        }
      }
    },
    skills: () => {
      const skillRows = skillRowsForDisplay(resumeJson, profile.layout.maxSkillsPerLine);
      if (skillRows.length) {
        docChildren.push(buildHeading(tokens, labelFor("skills")));
        for (const row of skillRows) {
          docChildren.push(row.label
            ? buildLabelledSkillLine(tokens, row)
            : buildBodyLine(tokens, row.text, { after: tokens.spacing.skill }));
        }
      }
    },
    education: () => {
      if (Array.isArray(education) && education.length) {
        docChildren.push(buildHeading(tokens, labelFor("education")));
        for (const ed of education) {
          const school = ed?.school ?? "";
          const degree = ed?.degree ?? "";
          const field = ed?.field ?? "";
          const dates = safeJoin([ed?.startDate, ed?.endDate], " – ");
          const sub = safeJoin([school, safeJoin([degree, field], ", "), dates, ed?.location], " | ");
          if (isNonEmptyString(sub)) docChildren.push(buildSubheading(tokens, sub));
        }
      }
    },
    projects: () => {
      if (Array.isArray(projects) && projects.length) {
        docChildren.push(buildHeading(tokens, labelFor("projects")));
        for (const p of projects) {
          const name = p?.name ?? "";
          const desc = p?.description ?? "";
          const label = isNonEmptyString(name) ? name.trim() : "Project";
          const projectLink = isNonEmptyString(p?.link) ? p.link.trim() : "";
          const href = linkHref(projectLink);
          const children = [displayRun(tokens, { text: label, bold: true, size: tokens.sizes.role })];
          if (projectLink) {
            children.push(
              displayRun(tokens, { text: " | ", bold: true, size: tokens.sizes.role })
            );
            children.push(
              href
                ? linkRun(tokens, { text: projectLink, href, size: tokens.sizes.role })
                : displayRun(tokens, { text: projectLink, bold: true, size: tokens.sizes.role })
            );
          }
          docChildren.push(new Paragraph({
            children,
            keepNext: tokens.pagination.roleKeepWithNext,
            keepLines: tokens.pagination.roleBlockKeepTogether,
            spacing: { before: tokens.spacing.role, after: 0 },
          }));
          if (isNonEmptyString(desc)) docChildren.push(buildBodyLine(tokens, desc.trim()));
          const highlights = Array.isArray(p?.highlights) ? p.highlights : [];
          for (const h of highlights) {
            if (isNonEmptyString(h)) docChildren.push(buildBodyLine(tokens, h.trim()));
          }
        }
      }
    },
    certifications: () => {
      if (Array.isArray(certifications) && certifications.length) {
        docChildren.push(buildHeading(tokens, labelFor("certifications")));
        for (const c of certifications) {
          const cert = normalizeCertification(c);
          if (!isNonEmptyString(cert.text)) continue;
          const href = linkHref(cert.credentialUrl ?? "");
          if (!href) {
            docChildren.push(buildBodyLine(tokens, cert.text));
            continue;
          }
          // linkRun makes the docx package write an external relationship, which
          // is what keeps the credential clickable once the file leaves here.
          docChildren.push(new Paragraph({
            children: [linkRun(tokens, { text: cert.text, href, size: tokens.sizes.body })],
            spacing: { before: 0, after: tokens.spacing.paragraph },
          }));
        }
      }
    },
    awards: () => {
      if (Array.isArray(awards_or_contributions) && awards_or_contributions.length) {
        docChildren.push(buildHeading(tokens, labelFor("awards")));
        for (const a of awards_or_contributions) {
          const title = (a && typeof a === "object" ? a.title : String(a)) ?? "";
          if (!isNonEmptyString(title)) continue;
          const desc = (a && typeof a === "object" ? a.description : "") ?? "";
          const year = (a && typeof a === "object" ? a.year : "") ?? "";
          const link = (a && typeof a === "object" ? a.link : "") ?? "";
          const line = [title, desc, year, link].filter(isNonEmptyString).join(" — ");
          docChildren.push(buildBodyLine(tokens, line));
        }
      }
    },
  };
  for (const key of sectionOrder) emitters[key]?.();

  const margin = tokens.margin;
  const doc = new Document({
    // Artifact metadata: the delivered file states which reviewed visual
    // contract produced it, so provenance does not depend on the filename.
    title: "Resume",
    description: `Labora resume style profile: ${profile.id} (${profile.displayName})`,
    keywords: `labora-style:${profile.id}`,
    styles: {
      default: {
        document: {
          run: { font: tokens.fontBody, size: tokens.sizes.body, color: tokens.colors.body },
          paragraph: { spacing: { line: tokens.line, lineRule: "auto" } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: margin, right: margin, bottom: margin, left: margin }
          }
        },
        children: docChildren
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);

  if (outputPath) {
    await fs.writeFile(outputPath, buffer);
  }

  return buffer;
}

/**
 * Map Agent 2 (job specialist) resume shape to formatter JSON shape.
 * Options: { job, maxSkills } — if both set, skills are capped to top maxSkills by relevance to job.description.
 */
export function agent2ResumeToFormatterJson(resume, options = {}) {
  if (!resume || typeof resume !== "object") return {};
  const contact = resume.contact && typeof resume.contact === "object" ? resume.contact : {};
  const experience = (resume.experience || []).map((e) => ({
    company: e.company ?? "",
    role: e.role ?? "",
    startDate: e.period ?? "",
    endDate: "",
    location: e.location ?? "",
    highlights: Array.isArray(e.bullets) ? e.bullets : [],
    progression: Array.isArray(e.progression) ? e.progression : [],
  }));
  const education = (resume.education || []).map((ed) => ({
    school: ed.school ?? "",
    degree: ed.degree ?? "",
    field: ed.field ?? "",
    location: ed.location ?? "",
    startDate: ed.startDate ?? "",
    endDate: ed.endDate ?? "",
  }));
  const projects = (resume.projects || []).map((p) => ({
    name: p.name ?? "",
    description: p.description ?? "",
    highlights: Array.isArray(p.highlights) ? p.highlights : [],
    link: p.link ?? "",
  }));
  const certs = (resume.certifications || []).map(normalizeCertification);
  const awards = (resume.awards_or_contributions || []).map((a) =>
    typeof a === "string"
      ? { title: a, description: "", year: "", link: "" }
      : { title: a.title ?? "", description: a.description ?? "", year: a.year ?? "", link: a.link ?? "" }
  ).filter((a) => isNonEmptyString(a.title));
  let skills = [...(resume.skills_primary || []), ...(resume.skills_secondary || [])];
  const job = options.job && typeof options.job === "object" ? options.job : null;
  const maxSkills = options.maxSkills;
  // The approved grouping is resolved from the same helper buildPresentation
  // uses, so the formatter boundary and the model cannot disagree about
  // whether a resume has one.
  const skillGroups = approvedSkillGroups(resume);
  if (skillGroups) {
    // Ranking and capping are how an *automatic* skill list is chosen. An
    // operator already chose these, so reordering them by job relevance would
    // overrule the decision, and dropping the sixteenth would silently delete
    // an approved skill. The flat list becomes the approved membership so
    // recall and ATS extraction see exactly what is printed.
    skills = flattenSkillGroups(skillGroups);
  } else if (job && typeof maxSkills === "number" && maxSkills > 0) {
    skills = topSkillsByRelevance(skills, job.description, maxSkills);
  }
  return {
    header: {
      name: (contact.name || resume.name) ?? "",
      title: resume.ats_title || resume.target_role || "",
      location: contact.location ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      linkedin: contact.linkedin ?? "",
      github: contact.github ?? "",
      portfolio: contact.portfolio ?? "",
    },
    summary: resume.summary ?? "",
    skills,
    // Null when no operator-approved grouping exists, which leaves the flat
    // ranked list above as the only skills input and preserves the automatic
    // behaviour every existing application relies on.
    skillGroups,
    experience,
    education,
    projects,
    certifications: certs,
    awards_or_contributions: awards,
    // Carried on the document, not on the style: a heading is words, and only
    // an operator-approved presentation block may put words on the page. Null
    // when no block was approved, which leaves every default heading in place.
    sectionLabels: resume.presentation?.approvedBy === "operator"
      ? (resume.presentation.sectionLabels ?? null)
      : null,
  };
}

/**
 * Render resume JSON to a text-layer PDF (HTML + Chromium). Primary deliverable.
 *
 * The page is printed from real HTML text, so the PDF carries a text layer that
 * a human can select and an ATS parser can extract. Nothing here rasterises the
 * resume.
 *
 * @param {object} opts - resumeJson, style (profile ID or resolved profile)
 */
export async function formatResumeToPdfBuffer(opts) {
  const { buffer } = await formatResumeToPdfWithLayout(opts);
  return buffer;
}

const LETTER_HEIGHT_INCHES = 11;
const CSS_PIXELS_PER_INCH = 96;

/**
 * Render the PDF and measure how much of each page the content actually fills.
 *
 * Measurement runs inside the Chromium instance this path already launches, so
 * it costs no extra dependency and no second render. It is deliberately done
 * for the PDF only: Word repaginates a DOCX when it opens the file and Node
 * cannot observe that, so a DOCX fill figure would be fiction. Parity between
 * the two renderers is parity of *grouping* decisions, not of page breaks.
 *
 * The measurement is reported, never acted on. Reflowing sections to fill a
 * page means deciding what to cut or expand, which is a content decision that
 * belongs to the operator.
 *
 * @param {object} opts - resumeJson, style (profile ID or resolved profile)
 * @returns {Promise<{ buffer: Buffer, layout: { pageCount: number, pageFillPercent: number[], finalPageFillPercent: number } }>}
 */
export async function formatResumeToPdfWithLayout({ resumeJson, style: styleParam }) {
  if (!resumeJson || typeof resumeJson !== "object") {
    throw new Error("resumeJson object is required");
  }
  const profile = renderStyle(styleParam);
  // puppeteer-core carries no browser of its own, so the executable has to be
  // supplied. See src/lib/browser.js for why that is the right trade.
  const [{ default: puppeteer }, { requireChrome }] = await Promise.all([
    import("puppeteer-core"),
    import("../lib/browser.js"),
  ]);
  const html = resumeJsonToHtml(resumeJson, profile);
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: requireChrome(),
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    // `load`, not `networkidle0`.
    //
    // This HTML is a self-contained string: no stylesheet link, no @import, no
    // web font, no image. There is no network activity to go idle, so
    // `networkidle0` bought nothing and charged for it -- it waits for a 500ms
    // quiet window measured by a heuristic that slips under CPU load, and on a
    // busy machine it slipped past the 30s navigation timeout and failed the
    // render outright. A résumé that will not render because the laptop was
    // busy is the worst failure this tool has.
    //
    // Verified equivalent: extracted text and the layout measurement are
    // byte-identical under both wait conditions. `test/format-pdf-text.test.js`
    // guards the precondition -- if a style profile ever adds a web font or a
    // remote asset, that test fails and this has to be reconsidered with it.
    await page.setContent(html, { waitUntil: "load" });

    // The print box, not the viewport: page.pdf() applies these margins to a
    // Letter sheet, so the usable height is what the content is paginated into.
    const usableHeightPx =
      (LETTER_HEIGHT_INCHES - profile.page.marginInches * 2) * CSS_PIXELS_PER_INCH;
    await page.setViewport({
      width: Math.round((8.5 - profile.page.marginInches * 2) * CSS_PIXELS_PER_INCH),
      height: Math.round(usableHeightPx),
    });
    // scrollHeight is not the content height: it never reports less than the
    // viewport, so every resume shorter than one page measured as exactly
    // full. Taking the bottom of the last laid-out block measures the content
    // itself, which is the number the underfill finding claims to be about.
    const contentHeightPx = await page.evaluate(() => {
      let bottom = 0;
      for (const element of document.body.children) {
        bottom = Math.max(bottom, element.getBoundingClientRect().bottom + window.scrollY);
      }
      return bottom;
    });

    const margin = `${profile.page.marginInches}in`;
    const pdfBuffer = await page.pdf({
      format: "Letter",
      margin: { top: margin, right: margin, bottom: margin, left: margin },
      printBackground: true,
    });
    const buffer = Buffer.from(pdfBuffer);

    // The DOM measurement models content as one continuous column, which is
    // not how Chromium paginates: it drops trailing whitespace at a break and
    // honours the profile's keep-together rules. A resume a hair over the
    // boundary therefore measured as an extra page that the PDF does not
    // contain, and the underfill finding pointed at a page nobody could open.
    // The artifact is the only authority on how many pages it has.
    const pageCount = await pdfPageCount(buffer);

    // Fill still comes from the DOM, because nothing else measures it, but it
    // is now expressed against the real final page. Where the continuous model
    // overshot, that page is simply full. Where it undershot, the model says
    // nothing about the real final page, so no figure is reported rather than
    // a fabricated one.
    const finalPageHeightPx = contentHeightPx - (pageCount - 1) * usableHeightPx;
    const finalPageRatio = finalPageHeightPx / usableHeightPx;
    const finalPageFillPercent = finalPageRatio <= 0
      ? null
      : Math.min(100, Math.max(1, Math.round(finalPageRatio * 100)));
    const pageFillPercent = Array.from({ length: pageCount }, (_, index) =>
      index === pageCount - 1 ? finalPageFillPercent : 100
    );

    return {
      buffer,
      layout: { pageCount, pageFillPercent, finalPageFillPercent },
    };
  } finally {
    await browser.close();
  }
}

/** The page count the artifact itself reports, read without extracting text. */
async function pdfPageCount(buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const { total } = await parser.getInfo();
    return Math.max(1, Number(total) || 1);
  } finally {
    await parser.destroy();
  }
}
