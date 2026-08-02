#!/usr/bin/env node
import fs from "node:fs";
import { loadJobFromFile } from "../lib/job-parser.js";
import { extractJobRequirements } from "../lib/job-requirements.js";
import { ZJobSpec } from "../schemas/job-spec.js";

const jobPath = process.argv[2];
const outputPath = process.argv[3];
if (!jobPath) {
  process.stderr.write("Usage: node src/tools/analyze-job.js <job.md> [job-spec.json]\n");
  process.exit(1);
}

try {
  const job = loadJobFromFile(jobPath);
  const spec = ZJobSpec.parse(extractJobRequirements({
    ...job,
    description: job.raw,
    sourcePath: jobPath,
  }));
  const json = JSON.stringify(spec, null, 2) + "\n";
  if (outputPath) {
    fs.writeFileSync(outputPath, json);
    process.stdout.write(`${outputPath}\n`);
  } else {
    process.stdout.write(json);
  }
} catch (error) {
  process.stderr.write(`analyze-job error: ${error.message}\n`);
  process.exit(1);
}
