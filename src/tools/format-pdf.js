#!/usr/bin/env node
// format-pdf.js — deterministic resume JSON -> text-layer PDF, printed through
// Chromium so the page keeps selectable, searchable, extractable text.
//
// Usage:
//   labora format-pdf <resume.json> <out.pdf> --contact <contact.md> --job <job.md> [--style ID]
import fs from "node:fs";
import {
  agent2ResumeToFormatterJson,
  formatResumeToPdfWithLayout,
} from "../agents/format-resume.js";
import { loadJobFromFile } from "../lib/job-parser.js";
import { injectContact, loadContact } from "../lib/profile-contact.js";
import { DEFAULT_STYLE_ID, listStyleProfiles, resolveStyleProfile } from "../lib/resume-style.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function styleHelp() {
  return listStyleProfiles()
    .map((profile) => `  ${profile.id.padEnd(20)} ${profile.displayName} — ${profile.signal}`)
    .join("\n");
}

const resumePath = process.argv[2];
const outputPath = process.argv[3];
if (!resumePath || !outputPath) {
  process.stderr.write(
    "Usage: labora format-pdf <resume.json> <out.pdf> --contact <contact.md> --job <job.md> " +
    `[--style ID]\n\nStyles (default ${DEFAULT_STYLE_ID}):\n${styleHelp()}\n`
  );
  process.exit(1);
}

try {
  let resume = ZTailoredResume.parse(JSON.parse(fs.readFileSync(resumePath, "utf8")));
  const contactPath = flag("--contact", flag("--context"));
  if (!contactPath) throw new Error("--contact <contact.md> is required.");
  resume = injectContact(resume, loadContact(contactPath));
  const jobPath = flag("--job");
  if (!jobPath) throw new Error("--job <job.md> is required.");
  const job = loadJobFromFile(jobPath);
  // Unknown styles fail here with the accepted list; there is no fallback.
  const style = resolveStyleProfile(flag("--style", DEFAULT_STYLE_ID)).id;
  const formatterJson = agent2ResumeToFormatterJson(resume, { job, maxSkills: 15 });
  const buffer = await formatResumeToPdfWithLayout({ resumeJson: formatterJson, style });
  fs.writeFileSync(outputPath, buffer.buffer);
  // Page fill can only be measured while the page is still laid out in
  // Chromium. Recording it beside the artifact lets validate-artifact report
  // the distribution without re-rendering.
  fs.writeFileSync(`${outputPath}.layout.json`, JSON.stringify(buffer.layout, null, 2) + "\n");
  process.stdout.write(`${outputPath}\n`);
} catch (error) {
  process.stderr.write(`format-pdf error: ${error.message}\n`);
  process.exit(1);
}
