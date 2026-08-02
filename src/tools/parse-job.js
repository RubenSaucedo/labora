#!/usr/bin/env node
// parse-job.js — deterministic job-description parser.
// Usage: node src/tools/parse-job.js <path-to-job.md>
// Prints: { title, company, description } as JSON to stdout.
import { loadJobFromFile } from "../lib/job-parser.js";

const jobPath = process.argv[2];
if (!jobPath) {
  process.stderr.write("Usage: node src/tools/parse-job.js <path-to-job.md>\n");
  process.exit(1);
}

try {
  const job = loadJobFromFile(jobPath);
  const { title, company, description } = job;
  process.stdout.write(JSON.stringify({ title, company, description }, null, 2) + "\n");
} catch (err) {
  process.stderr.write(`parse-job error: ${err.message}\n`);
  process.exit(1);
}
