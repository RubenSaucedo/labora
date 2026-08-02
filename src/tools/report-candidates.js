#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ZJobSearchReport } from "../schemas/job-search.js";
import { renderJobSearchReport } from "../lib/job-search.js";

/**
 * Render a human-readable report.md from candidates.json.
 *
 * Usage: node src/tools/report-candidates.js <run-dir/candidates.json> [out.md]
 *
 * When candidates.json carries cross-run dedup data, the report leads with
 * genuinely new leads and marks how many runs each posting has appeared in.
 */
const inPath = process.argv[2];
if (!inPath) {
  process.stderr.write("Usage: node src/tools/report-candidates.js <candidates.json> [out.md]\n");
  process.exit(1);
}
const outPath = process.argv[3] || path.join(path.dirname(inPath), "report.md");

try {
  const report = ZJobSearchReport.parse(JSON.parse(fs.readFileSync(inPath, "utf8")));
  fs.writeFileSync(outPath, renderJobSearchReport(report));
  process.stdout.write(`${outPath}\n`);
} catch (error) {
  process.stderr.write(`report-candidates error: ${error.message}\n`);
  process.exit(1);
}

