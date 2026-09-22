#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { hashColdReaderInput, prepareColdReaderInput, privateContextLeaks } from "../lib/reader-context.js";

/**
 * Build the cold reader's entire world: rendered text, the posting, an audience
 * label.
 *
 * This tool exists so that the isolation is produced by code rather than by an
 * agent choosing what to paste. A sub-agent asked to "read this resume without
 * looking at the evidence" is one context window away from having looked at it;
 * a file containing three strings is not.
 *
 * It deliberately takes the *extracted artifact text*, not `resume.json`. The
 * JSON carries provenance, notes and recorded gaps, and a reader who can see
 * which bullet the author was worried about is no longer a cold reader.
 */

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const artifactTextPath = process.argv[2];
if (!artifactTextPath || artifactTextPath.startsWith("--")) {
  process.stderr.write(
    "Usage: labora prepare-reader-input <artifact-text.txt> [--job <job.md>]\n" +
    "         [--audience recruiter|engineering_manager|technical_screener] [--output <reader-input.json>]\n"
  );
  process.exit(1);
}

try {
  const resumeText = fs.readFileSync(artifactTextPath, "utf8");
  const jobPath = flag("--job");
  const postingText = jobPath ? fs.readFileSync(jobPath, "utf8") : "";
  const input = prepareColdReaderInput({
    resumeText,
    postingText,
    audience: flag("--audience", "recruiter"),
  });

  // Belt and braces. The schema already strips unknown keys; this states the
  // guarantee out loud so a future change that widens the input fails here
  // rather than silently in production.
  const leaks = privateContextLeaks(input);
  if (leaks.length) {
    process.stderr.write(`prepare-reader-input error: private context would reach the cold reader: ${leaks.join(", ")}\n`);
    process.exit(1);
  }

  const payload = { ...input, inputHash: hashColdReaderInput(input) };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const outputPath = flag("--output");
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
} catch (error) {
  process.stderr.write(`prepare-reader-input error: ${error.message}\n`);
  process.exit(1);
}
