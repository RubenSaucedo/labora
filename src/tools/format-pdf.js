#!/usr/bin/env node
import fs from "node:fs";
import {
  agent2ResumeToFormatterJson,
  formatResumeToPdfBuffer,
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
    "Usage: node src/tools/format-pdf.js <resume.json> <out.pdf> --contact <contact.md> --job <job.md> [--style N]\n"
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
  const style = Number(flag("--style", "1"));
  const formatterJson = agent2ResumeToFormatterJson(resume, { job, maxSkills: 15 });
  const buffer = await formatResumeToPdfBuffer({ resumeJson: formatterJson, style });
  fs.writeFileSync(outputPath, buffer);
  process.stdout.write(`${outputPath}\n`);
} catch (error) {
  process.stderr.write(`format-pdf error: ${error.message}\n`);
  process.exit(1);
}
