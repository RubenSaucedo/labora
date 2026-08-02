import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import fs from "fs/promises";

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

// ---- Style presets (1 = Classic ATS, 2 = Clean modern, 3 = Compact, 4 = 2027) ----
// Font sizes in half-points for docx: 11pt = 22, 12pt = 24, 22pt = 44. Margins in twips (720 = 0.5 in).
const STYLES = {
  1: {
    name: "Classic ATS",
    font: "Arial",
    sizeName: 44,
    sizeHeading: 24,
    sizeBody: 22,
    marginTwips: 720,
    headingBorder: "1pt solid #000",
    spacingAfterBody: 48,
    spacingAfterBullet: 32,
    spacingBeforeHeading: 180,
    spacingAfterHeading: 80,
    lineHeight: 1.25,
    marginIn: "0.5in"
  },
  2: {
    name: "Clean modern",
    font: "Calibri",
    sizeName: 40,
    sizeHeading: 22,
    sizeBody: 21,
    marginTwips: 720,
    headingBorder: "none",
    spacingAfterBody: 40,
    spacingAfterBullet: 28,
    spacingBeforeHeading: 160,
    spacingAfterHeading: 64,
    lineHeight: 1.2,
    marginIn: "0.5in"
  },
  3: {
    name: "Compact",
    font: "Arial",
    sizeName: 36,
    sizeHeading: 22,
    sizeBody: 20,
    marginTwips: 648,
    headingBorder: "1pt solid #333",
    spacingAfterBody: 32,
    spacingAfterBullet: 24,
    spacingBeforeHeading: 120,
    spacingAfterHeading: 48,
    lineHeight: 1.15,
    marginIn: "0.45in"
  },
  // Style 4: inspired by a modern single-column resume — Calibri, 14pt name/headings, 12pt body, no border, clean spacing
  4: {
    name: "2027",
    font: "Calibri",
    sizeName: 28,
    sizeHeading: 28,
    sizeBody: 24,
    marginTwips: 720,
    headingBorder: "none",
    spacingAfterBody: 36,
    spacingAfterBullet: 24,
    spacingBeforeHeading: 140,
    spacingAfterHeading: 56,
    lineHeight: 1.2,
    marginIn: "0.5in"
  }
};

function getStyle(styleId) {
  const id = styleId === 2 || styleId === 3 || styleId === 4 ? styleId : 1;
  return STYLES[id];
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function safeJoin(parts, sep = " | ") {
  return parts.filter(isNonEmptyString).join(sep);
}

// A long tenure at one employer reads as stagnation unless the promotions inside
// it are visible. Internal ladder tokens ("L62") mean nothing to an outside
// reader and may be confidential, so a step renders its `externalLabel` when one
// is set and is withheld entirely when marked `internal_only`.
export function formatProgression(progression) {
  if (!Array.isArray(progression)) return "";
  const steps = progression
    .filter((step) => step && step.disclosure !== "internal_only")
    .map((step) => ({
      label: (isNonEmptyString(step.externalLabel) ? step.externalLabel : step.label || "").trim(),
      date: isNonEmptyString(step.date) ? step.date.trim() : "",
    }))
    .filter((step) => isNonEmptyString(step.label));
  if (steps.length === 0) return "";

  // Two promotions generalized to the same external label would otherwise read
  // "Promoted 2021 -> Promoted 2024". Collapsing repeats states the same
  // verified facts in the form a reader actually scans for: how many, and when.
  const labels = new Set(steps.map((step) => step.label));
  const dates = steps.map((step) => step.date).filter(isNonEmptyString);
  if (labels.length !== 0 && labels.size === 1 && steps.length > 1 && dates.length === steps.length) {
    const [label] = [...labels];
    const times = steps.length === 2 ? "twice" : `${steps.length} times`;
    return `${label} ${times} (${dates.join(", ")})`;
  }

  return steps
    .map((step) => (step.date ? `${step.label} ${step.date}` : step.label))
    .join(" \u2192 ");
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
 *    startDate?: string,
 *    endDate?: string,
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

function run(style, options) {
  return new TextRun({ font: style.font, ...options });
}

function buildHeading(style, text) {
  return new Paragraph({
    children: [run(style, { text, bold: true, size: style.sizeHeading })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: style.spacingBeforeHeading, after: style.spacingAfterHeading }
  });
}

function buildSubheading(style, text) {
  return new Paragraph({
    children: [run(style, { text, bold: true, size: style.sizeBody })],
    spacing: { before: 60, after: 40 }
  });
}

function buildBodyLine(style, text) {
  return new Paragraph({
    children: [run(style, { text, size: style.sizeBody })],
    spacing: { before: 0, after: style.spacingAfterBody }
  });
}

function buildBullet(style, text) {
  return new Paragraph({
    children: [run(style, { text, size: style.sizeBody })],
    bullet: { level: 0 },
    spacing: { before: 0, after: style.spacingAfterBullet }
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

/** Chunk skills into 2–3 comma-separated lines for readability (avoid 15+ single-word lines). */
function formatSkillsForDisplay(skills, maxPerLine = 7) {
  const arr = normalizeSkills(skills);
  if (arr.length === 0) return [];
  const lines = [];
  for (let i = 0; i < arr.length; i += maxPerLine) {
    lines.push(arr.slice(i, i + maxPerLine).join(", "));
  }
  return lines;
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
 * @param {object} resumeJson - Formatter JSON (header, summary, skills, experience, etc.)
 * @param {number} [styleId=1] - 1 = Classic ATS, 2 = Clean modern, 3 = Compact, 4 = 2027
 */
export function resumeJsonToHtml(resumeJson, styleId = 1) {
  if (!resumeJson || typeof resumeJson !== "object") return "";

  const style = getStyle(styleId);
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

  const skillLines = formatSkillsForDisplay(skills);
  const parts = [];

  const bodyPt = style.sizeBody / 2;
  const headingPt = style.sizeHeading / 2;
  const namePt = style.sizeName / 2;
  const sectionBorder = style.headingBorder !== "none" ? `border-bottom: ${style.headingBorder};` : "";

  parts.push(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Resume</title>`);
  parts.push(`<style>
body { font-family: ${style.font}, sans-serif; font-size: ${bodyPt}pt; margin: ${style.marginIn}; line-height: ${style.lineHeight}; color: #000; }
h1 { font-size: ${namePt}pt; font-weight: bold; margin: 0 0 6pt 0; }
.sub { font-size: ${bodyPt}pt; font-weight: bold; margin: 8pt 0 4pt 0; }
.section { font-size: ${headingPt}pt; font-weight: bold; margin: 14pt 0 6pt 0; ${sectionBorder} }
p, ul { margin: 0 0 6pt 0; }
ul { padding-left: 20px; }
</style></head><body>`);

  if (isNonEmptyString(header.name)) {
    parts.push(`<h1>${escapeHtml(header.name.trim())}</h1>`);
  }
  if (isNonEmptyString(header.title)) {
    parts.push(`<p><em>${escapeHtml(header.title.trim())}</em></p>`);
  }
  const contactParts = [header.location, header.email, header.phone, header.linkedin, header.github, header.portfolio].filter(isNonEmptyString);
  if (contactParts.length) {
    parts.push(`<p>${escapeHtml(contactParts.join(" | "))}</p>`);
  }

  if (isNonEmptyString(summary)) {
    parts.push(`<p class="section">Summary</p><p>${escapeHtml(summary.trim())}</p>`);
  }

  if (Array.isArray(experience) && experience.length) {
    parts.push(`<p class="section">Experience</p>`);
    for (const exp of experience) {
      const company = exp?.company ?? "";
      const role = exp?.role ?? "";
      const dates = safeJoin([exp?.startDate, exp?.endDate], " – ");
      const loc = exp?.location ?? "";
      const titleLine = isNonEmptyString(role) && isNonEmptyString(company) ? `${role} at ${company}` : safeJoin([role, company], " at ");
      const subLine = loc ? `${titleLine} | ${dates} | ${loc}` : (dates ? `${titleLine} | ${dates}` : titleLine);
      if (isNonEmptyString(subLine)) parts.push(`<p class="sub">${escapeHtml(subLine)}</p>`);
      const progressionLine = formatProgression(exp?.progression);
      if (progressionLine) parts.push(`<p><em>${escapeHtml(progressionLine)}</em></p>`);
      const highlights = Array.isArray(exp?.highlights) ? exp.highlights : [];
      if (highlights.length) {
        parts.push("<ul>");
        for (const h of highlights) {
          if (isNonEmptyString(h)) parts.push(`<li>${escapeHtml(h.trim())}</li>`);
        }
        parts.push("</ul>");
      }
    }
  }

  if (skillLines.length) {
    parts.push(`<p class="section">Skills</p>`);
    for (const line of skillLines) parts.push(`<p>${escapeHtml(line)}</p>`);
  }

  if (Array.isArray(education) && education.length) {
    parts.push(`<p class="section">Education</p>`);
    for (const ed of education) {
      const school = ed?.school ?? "";
      const degree = ed?.degree ?? "";
      const field = ed?.field ?? "";
      const dates = safeJoin([ed?.startDate, ed?.endDate], " – ");
      const sub = safeJoin([school, safeJoin([degree, field], ", "), dates, ed?.location], " | ");
      if (isNonEmptyString(sub)) parts.push(`<p class="sub">${escapeHtml(sub)}</p>`);
    }
  }

  if (Array.isArray(projects) && projects.length) {
    parts.push(`<p class="section">Projects</p>`);
    for (const p of projects) {
      const name = p?.name ?? "";
      const desc = p?.description ?? "";
      const titleLine = safeJoin([isNonEmptyString(name) ? name.trim() : "Project", p?.link], " | ");
      parts.push(`<p class="sub">${escapeHtml(titleLine)}</p>`);
      if (isNonEmptyString(desc)) parts.push(`<p>${escapeHtml(desc.trim())}</p>`);
      const highlights = Array.isArray(p?.highlights) ? p.highlights : [];
      for (const h of highlights) {
        if (isNonEmptyString(h)) parts.push(`<p>${escapeHtml(h.trim())}</p>`);
      }
    }
  }

  if (Array.isArray(certifications) && certifications.length) {
    parts.push(`<p class="section">Certifications</p>`);
    for (const c of certifications) {
      if (isNonEmptyString(c)) parts.push(`<p>${escapeHtml(c.trim())}</p>`);
    }
  }

  if (Array.isArray(awards_or_contributions) && awards_or_contributions.length) {
    parts.push(`<p class="section">Awards & Contributions</p>`);
    for (const a of awards_or_contributions) {
      const title = (a && typeof a === "object" ? a.title : String(a)) ?? "";
      if (!isNonEmptyString(title)) continue;
      const desc = (a && typeof a === "object" ? a.description : "") ?? "";
      const year = (a && typeof a === "object" ? a.year : "") ?? "";
      const link = (a && typeof a === "object" ? a.link : "") ?? "";
      const line = [title, desc, year, link].filter(isNonEmptyString).join(" — ");
      parts.push(`<p>${escapeHtml(line)}</p>`);
    }
  }

  parts.push("</body></html>");
  return parts.join("");
}

export async function formatResumeToDocxBuffer({
  resumeJson,
  outputPath,
  style: styleParam
}) {
  if (!resumeJson || typeof resumeJson !== "object") {
    throw new Error("resumeJson object is required");
  }

  const style = getStyle(styleParam ?? 1);
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

  // ---- Contact block: Name, Title, Contact (FAANG order) ----
  if (isNonEmptyString(header.name)) {
    docChildren.push(
      new Paragraph({
        children: [run(style, { text: header.name.trim(), bold: true, size: style.sizeName })],
        spacing: { after: 60 }
      })
    );
  }
  if (isNonEmptyString(header.title)) {
    docChildren.push(
      new Paragraph({
        children: [run(style, { text: header.title.trim(), italics: true, size: style.sizeBody })],
        spacing: { after: style.spacingAfterBody }
      })
    );
  }
  const contactParts = [header.location, header.email, header.phone, header.linkedin, header.github, header.portfolio].filter(isNonEmptyString);
  if (contactParts.length) {
    docChildren.push(buildBodyLine(style, contactParts.join(" | ")));
  }

  // ---- Summary ----
  if (isNonEmptyString(summary)) {
    docChildren.push(buildHeading(style, "Summary"));
    docChildren.push(buildBodyLine(style, summary.trim()));
  }

  // ---- Experience (Role at Company + dates) ----
  if (Array.isArray(experience) && experience.length) {
    docChildren.push(buildHeading(style, "Experience"));
    for (const exp of experience) {
      const company = exp?.company ?? "";
      const role = exp?.role ?? "";
      const dates = safeJoin([exp?.startDate, exp?.endDate], " – ");
      const loc = exp?.location ?? "";
      const titleLine = isNonEmptyString(role) && isNonEmptyString(company)
        ? `${role} at ${company}`
        : safeJoin([role, company], " at ");
      const subLine = loc ? `${titleLine} | ${dates} | ${loc}` : (dates ? `${titleLine} | ${dates}` : titleLine);
      if (isNonEmptyString(subLine)) docChildren.push(buildSubheading(style, subLine));
      const progressionLine = formatProgression(exp?.progression);
      if (progressionLine) docChildren.push(buildBodyLine(style, progressionLine));
      const highlights = Array.isArray(exp?.highlights) ? exp.highlights : [];
      for (const h of highlights) {
        if (isNonEmptyString(h)) docChildren.push(buildBullet(style, h.trim()));
      }
    }
  }

  // ---- Skills (2–3 comma-separated lines) ----
  const skillLines = formatSkillsForDisplay(skills);
  if (skillLines.length) {
    docChildren.push(buildHeading(style, "Skills"));
    for (const line of skillLines) {
      docChildren.push(buildBodyLine(style, line));
    }
  }

  // ---- Education ----
  if (Array.isArray(education) && education.length) {
    docChildren.push(buildHeading(style, "Education"));
    for (const ed of education) {
      const school = ed?.school ?? "";
      const degree = ed?.degree ?? "";
      const field = ed?.field ?? "";
      const dates = safeJoin([ed?.startDate, ed?.endDate], " – ");
      const sub = safeJoin([school, safeJoin([degree, field], ", "), dates, ed?.location], " | ");
      if (isNonEmptyString(sub)) docChildren.push(buildSubheading(style, sub));
    }
  }

  // ---- Projects ----
  if (Array.isArray(projects) && projects.length) {
    docChildren.push(buildHeading(style, "Projects"));
    for (const p of projects) {
      const name = p?.name ?? "";
      const desc = p?.description ?? "";
      const titleLine = safeJoin([isNonEmptyString(name) ? name.trim() : "Project", p?.link], " | ");
      docChildren.push(buildSubheading(style, titleLine));
      if (isNonEmptyString(desc)) docChildren.push(buildBodyLine(style, desc.trim()));
      const highlights = Array.isArray(p?.highlights) ? p.highlights : [];
      for (const h of highlights) {
        if (isNonEmptyString(h)) docChildren.push(buildBodyLine(style, h.trim()));
      }
    }
  }

  // ---- Certifications ----
  if (Array.isArray(certifications) && certifications.length) {
    docChildren.push(buildHeading(style, "Certifications"));
    for (const c of certifications) {
      if (isNonEmptyString(c)) docChildren.push(buildBodyLine(style, c.trim()));
    }
  }

  // ---- Awards & Contributions ----
  if (Array.isArray(awards_or_contributions) && awards_or_contributions.length) {
    docChildren.push(buildHeading(style, "Awards & Contributions"));
    for (const a of awards_or_contributions) {
      const title = (a && typeof a === "object" ? a.title : String(a)) ?? "";
      if (!isNonEmptyString(title)) continue;
      const desc = (a && typeof a === "object" ? a.description : "") ?? "";
      const year = (a && typeof a === "object" ? a.year : "") ?? "";
      const link = (a && typeof a === "object" ? a.link : "") ?? "";
      const line = [title, desc, year, link].filter(isNonEmptyString).join(" — ");
      docChildren.push(buildBodyLine(style, line));
    }
  }

  const margin = style.marginTwips;
  const doc = new Document({
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
  const certs = (resume.certifications || []).map((c) =>
    typeof c === "string" ? c : (c && c.name ? [c.name, c.issuer, c.year].filter(Boolean).join(", ") : String(c))
  );
  const awards = (resume.awards_or_contributions || []).map((a) =>
    typeof a === "string"
      ? { title: a, description: "", year: "", link: "" }
      : { title: a.title ?? "", description: a.description ?? "", year: a.year ?? "", link: a.link ?? "" }
  ).filter((a) => isNonEmptyString(a.title));
  let skills = [...(resume.skills_primary || []), ...(resume.skills_secondary || [])];
  const job = options.job && typeof options.job === "object" ? options.job : null;
  const maxSkills = options.maxSkills;
  if (job && typeof maxSkills === "number" && maxSkills > 0) {
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
    experience,
    education,
    projects,
    certifications: certs,
    awards_or_contributions: awards,
  };
}

/**
 * Render resume JSON to PDF buffer (HTML + Puppeteer). Primary deliverable for top companies.
 * @param {object} opts - resumeJson, style (1, 2, or 3; default 1)
 */
export async function formatResumeToPdfBuffer({ resumeJson, style: styleParam }) {
  if (!resumeJson || typeof resumeJson !== "object") {
    throw new Error("resumeJson object is required");
  }
  const style = getStyle(styleParam ?? 1);
  const { default: puppeteer } = await import("puppeteer");
  const html = resumeJsonToHtml(resumeJson, styleParam ?? 1);
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const margin = style.marginIn;
    const pdfBuffer = await page.pdf({
      format: "Letter",
      margin: { top: margin, right: margin, bottom: margin, left: margin },
      printBackground: true,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
