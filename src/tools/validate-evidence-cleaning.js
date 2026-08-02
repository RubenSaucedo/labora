#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateEvidenceCleaning } from "../lib/evidence-cleaning.js";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const extractedPath = process.argv[2];
const cleanedPath = process.argv[3];
const outputPath = flag("--output");
const metadataPath = flag("--metadata");

if (!extractedPath || !cleanedPath || !metadataPath) {
  process.stderr.write(
    "Usage: node src/tools/validate-evidence-cleaning.js <extracted.md> <cleaned.md> --metadata <extracted.json> [--output <validation.json>]\n"
  );
  process.exit(1);
}

try {
  const extractedBuffer = fs.readFileSync(extractedPath);
  const cleanedBuffer = fs.readFileSync(cleanedPath);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (!metadata.sourcePath || !fs.existsSync(metadata.sourcePath)) {
    throw new Error("Extraction metadata sourcePath is missing or unavailable.");
  }
  const hash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
  const result = validateEvidenceCleaning({
    extractedText: extractedBuffer.toString("utf8"),
    cleanedText: cleanedBuffer.toString("utf8"),
    sourceHash: hash(fs.readFileSync(metadata.sourcePath)),
    expectedSourceHash: metadata.sourceHash,
    extractedHash: hash(extractedBuffer),
    expectedExtractedHash: metadata.extractedHash,
    cleanedHash: hash(cleanedBuffer),
  });
  const json = JSON.stringify(result, null, 2) + "\n";
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
  if (!result.valid) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`validate-evidence-cleaning error: ${error.message}\n`);
  process.exit(1);
}
