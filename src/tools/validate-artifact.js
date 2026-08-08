#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractTextFromDocx, extractHtmlTextFromDocx } from "../utils/docx-to-text.js";
import { extractTextFromPdf, extractTextFromPdfViaOcr } from "../utils/pdf-to-md.js";
import { injectContact, loadContact } from "../lib/profile-contact.js";
import { validateRenderedArtifact, crossParserDivergence } from "../lib/validate-artifact.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";
import { assertSafeDocument } from "../lib/file-safety.js";
import { agent2ResumeToFormatterJson } from "../agents/format-resume.js";
import { loadJobFromFile } from "../lib/job-parser.js";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const resumePath = process.argv[2];
const artifactPath = process.argv[3];
const contactPath = flag("--contact") || flag("--context");
const outputPath = flag("--output");
const jobPath = flag("--job");
const crossParser = hasFlag("--cross-parser");
if (!resumePath || !artifactPath || !contactPath || !jobPath) {
  process.stderr.write("Usage: labora validate-artifact <resume.json> <resume.docx|resume.pdf> --contact <contact.md> --job <job.md> [--output <validation.json>] [--cross-parser]\n");
  process.exit(1);
}
try {
  let resume = ZTailoredResume.parse(JSON.parse(fs.readFileSync(resumePath, "utf8")));
  resume = injectContact(resume, loadContact(contactPath));
  const formatterResume = agent2ResumeToFormatterJson(resume, {
    job: loadJobFromFile(jobPath),
    maxSkills: 15,
  });
  const extension = path.extname(artifactPath).toLowerCase();
  let safeArtifactPath;
  let extractedText;
  let pageCount = null;
  let secondaryText = null;
  let secondaryParser = null;
  if (extension === ".docx") {
    safeArtifactPath = assertSafeDocument(artifactPath, "docx");
    extractedText = await extractTextFromDocx({ path: safeArtifactPath });
    if (crossParser) {
      secondaryText = await extractHtmlTextFromDocx({ path: safeArtifactPath });
      secondaryParser = "mammoth-html";
    }
  } else if (extension === ".pdf") {
    safeArtifactPath = assertSafeDocument(artifactPath, "pdf");
    const buffer = fs.readFileSync(safeArtifactPath);
    const extracted = await extractTextFromPdf(buffer);
    extractedText = extracted.text;
    pageCount = extracted.numpages;
    if (crossParser) {
      const ocr = await extractTextFromPdfViaOcr(buffer, { numpages: pageCount });
      secondaryText = ocr.text;
      secondaryParser = "ocr-render";
    }
  } else {
    throw new Error("Artifact must be DOCX or PDF.");
  }
  const result = {
    ...validateRenderedArtifact({ resume: formatterResume, extractedText }),
    artifactPath: path.basename(safeArtifactPath),
    artifactType: extension.slice(1),
    artifactHash: crypto.createHash("sha256").update(fs.readFileSync(safeArtifactPath)).digest("hex"),
    pageCount,
  };
  if (crossParser) {
    result.crossParser = crossParserDivergence({
      resume: formatterResume,
      primaryText: extractedText,
      secondaryText,
      secondaryParser,
    });
    result.issues = [...result.issues, ...result.crossParser.issues];
  }
  const json = JSON.stringify(result, null, 2) + "\n";
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
  if (!result.valid) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`validate-artifact error: ${error.message}\n`);
  process.exit(1);
}
