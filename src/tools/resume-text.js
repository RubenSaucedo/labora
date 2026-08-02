#!/usr/bin/env node
// resume-text.js — serialize a structured resume JSON to plain text.
// Used as the input the HR / engineer judges read.
// Usage: node src/tools/resume-text.js <resume.json>
import fs from "node:fs";
import { resumeToText } from "../lib/resume-to-text.js";

const resumePath = process.argv[2];
if (!resumePath) {
  process.stderr.write("Usage: node src/tools/resume-text.js <resume.json>\n");
  process.exit(1);
}

try {
  const resume = JSON.parse(fs.readFileSync(resumePath, "utf-8"));
  process.stdout.write(resumeToText(resume) + "\n");
} catch (err) {
  process.stderr.write(`resume-text error: ${err.message}\n`);
  process.exit(1);
}
