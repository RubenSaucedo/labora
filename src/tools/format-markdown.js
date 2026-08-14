#!/usr/bin/env node
// format-markdown.js - deterministic resume JSON -> Markdown review companion.
// The output is editable feedback, never a claim source or selected delivery
// artifact.
import fs from "node:fs";
import {
  agent2ResumeToFormatterJson,
  resumeJsonToMarkdown,
} from "../agents/format-resume.js";
import { loadJobFromFile } from "../lib/job-parser.js";
import { injectContact, loadContact } from "../lib/profile-contact.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const resumePath = process.argv[2];
const outputPath = process.argv[3];
if (!resumePath || !outputPath) {
  process.stderr.write(
    "Usage: labora format-markdown <resume.json> <out.md> --contact <contact.md> --job <job.md> [--max-skills N]\n"
  );
  process.exit(1);
}

try {
  const contactPath = flag("--contact", flag("--context"));
  if (!contactPath) throw new Error("--contact <contact.md> is required.");
  const jobPath = flag("--job");
  if (!jobPath) throw new Error("--job <job.md> is required.");
  const maxSkills = Number.parseInt(flag("--max-skills", "15"), 10) || 15;

  let resume = ZTailoredResume.parse(JSON.parse(fs.readFileSync(resumePath, "utf8")));
  resume = injectContact(resume, loadContact(contactPath));
  const formatterJson = agent2ResumeToFormatterJson(resume, {
    job: loadJobFromFile(jobPath),
    maxSkills,
  });
  fs.writeFileSync(outputPath, resumeJsonToMarkdown(formatterJson), "utf8");
  process.stdout.write(`${outputPath}\n`);
} catch (error) {
  process.stderr.write(`format-markdown error: ${error.message}\n`);
  process.exit(1);
}
