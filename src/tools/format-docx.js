#!/usr/bin/env node
// format-docx.js — deterministic resume JSON -> ATS-friendly DOCX.
// This tool never rewrites content; it only maps fields into a styled document.
//
// Usage:
//   node src/tools/format-docx.js <resume.json> <out.docx> --contact <contact.md> --job <job.md> [--style N] [--max-skills N]
//
// --style N   1=Classic ATS (default), 2=Clean modern, 3=Compact, 4=2027
// --job       optional job.md to inform formatter ordering
// --max-skills default 15
import fs from "node:fs";
import {
  agent2ResumeToFormatterJson,
  formatResumeToDocxBuffer,
} from "../agents/format-resume.js";
import { loadJobFromFile } from "../lib/job-parser.js";
import { injectContact, loadContact } from "../lib/profile-contact.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const resumePath = process.argv[2];
const outPath = process.argv[3];
if (!resumePath || !outPath || resumePath.startsWith("--")) {
  process.stderr.write(
    "Usage: node src/tools/format-docx.js <resume.json> <out.docx> --contact <contact.md> --job <job.md> [--style N] [--max-skills N]\n"
  );
  process.exit(1);
}

const styleArg = parseInt(getFlag("--style", "1"), 10);
const style = [1, 2, 3, 4].includes(styleArg) ? styleArg : 1;
const maxSkills = parseInt(getFlag("--max-skills", "15"), 10) || 15;
const jobPath = getFlag("--job", null);
const contactPath = getFlag("--contact", getFlag("--context", null));
if (!contactPath) {
  process.stderr.write("--contact <contact.md> is required so private contact data is injected deterministically.\n");
  process.exit(1);
}
if (!jobPath) {
  process.stderr.write("--job <job.md> is required so rendering and validation select the same skills.\n");
  process.exit(1);
}

try {
  let resume = ZTailoredResume.parse(JSON.parse(fs.readFileSync(resumePath, "utf-8")));
  resume = injectContact(resume, loadContact(contactPath));
  const job = loadJobFromFile(jobPath);
  const formatterJson = agent2ResumeToFormatterJson(resume, { job, maxSkills });
  const buffer = await formatResumeToDocxBuffer({ resumeJson: formatterJson, style });
  fs.writeFileSync(outPath, buffer);
  process.stdout.write(`${outPath}\n`);
} catch (err) {
  process.stderr.write(`format-docx error: ${err.message}\n`);
  process.exit(1);
}
