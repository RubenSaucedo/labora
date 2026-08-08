#!/usr/bin/env node
// score-ats.js — deterministic (scripted) ATS coverage scorer.
// This is the fast, free, in-loop gate the tailor skill uses to decide whether
// keyword coverage is high enough. It is NOT an LLM. See judge-ats for the
// LLM read of the final DOCX.
//
// Usage: labora score-ats <resume.json> <job.md>
// Prints the full ATS scoring payload as JSON to stdout.
import fs from "node:fs";
import { scoreAts } from "../lib/score-resume-ats.js";
import { loadJobFromFile } from "../lib/job-parser.js";
import { ZJobSpec } from "../schemas/job-spec.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const resumePath = process.argv[2];
const jobPath = process.argv[3];
if (!resumePath || !jobPath) {
  process.stderr.write("Usage: labora score-ats <resume.json> <job.md> [--job-spec <job-spec.json>]\n");
  process.exit(1);
}

try {
  const resume = ZTailoredResume.parse(JSON.parse(fs.readFileSync(resumePath, "utf-8")));
  const job = loadJobFromFile(jobPath);
  const jobSpecPath = flag("--job-spec");
  const jobSpec = jobSpecPath
    ? ZJobSpec.parse(JSON.parse(fs.readFileSync(jobSpecPath, "utf8")))
    : null;
  const result = scoreAts({ resume, job, jobSpec });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (err) {
  process.stderr.write(`score-ats error: ${err.message}\n`);
  process.exit(1);
}
