#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractTextFromDocx, extractHtmlTextFromDocx, extractLinkTargetsFromDocx } from "../utils/docx-to-text.js";
import { readDocxStyleProfileId } from "../utils/docx-parts.js";
import { extractTextFromPdf, extractTextFromPdfViaOcr } from "../utils/pdf-to-md.js";
import { injectContact, loadContact } from "../lib/profile-contact.js";
import { validateRenderedArtifact, crossParserDivergence } from "../lib/validate-artifact.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";
import { assertSafeDocument } from "../lib/file-safety.js";
import { agent2ResumeToFormatterJson } from "../agents/format-resume.js";
import { loadJobFromFile } from "../lib/job-parser.js";
import { DEFAULT_STYLE_ID, resolveStyleProfile, styleProfileIds } from "../lib/resume-style.js";

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
  process.stderr.write(
    "Usage: labora validate-artifact <resume.json> <resume.docx|resume.pdf> --contact <contact.md> " +
    "--job <job.md> [--style ID] [--output <validation.json>] [--cross-parser]\n\n" +
    `Styles: ${styleProfileIds().join(", ")}\n`
  );
  process.exit(1);
}

// The artifact record names the visual contract the file was rendered under.
// Taken from --style when given, otherwise from the artifact's own name, which
// the formatter and run state both build from the same profile ID.
function styleFromArtifactName(name) {
  const match = /^final-resume-style-(.+)\.(docx|pdf)$/i.exec(path.basename(name));
  return match ? match[1] : null;
}

/** Read the measured page fill format-pdf wrote next to the artifact, if any. */
function loadLayoutSidecar(artifactPath) {
  const sidecar = `${artifactPath}.layout.json`;
  if (!fs.existsSync(sidecar)) return null;
  try {
    return JSON.parse(fs.readFileSync(sidecar, "utf8"));
  } catch {
    // A corrupt sidecar must not fail a render that is otherwise valid; the
    // layout checks simply do not run.
    return null;
  }
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
  let declaredStyleId = null;
  let pageCount = null;
  let secondaryText = null;
  let secondaryParser = null;
  // Stays null for a PDF: pdf-parse does not expose link annotations, and an
  // empty list would report every link as dropped.
  let linkTargets = null;
  if (extension === ".docx") {
    safeArtifactPath = assertSafeDocument(artifactPath, "docx");
    extractedText = await extractTextFromDocx({ path: safeArtifactPath });
    linkTargets = await extractLinkTargetsFromDocx({ path: safeArtifactPath });
    // The DOCX states its own style profile in its core properties, so the
    // record can be checked against the artifact instead of trusting a flag.
    declaredStyleId = readDocxStyleProfileId({ path: safeArtifactPath });
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
  const requestedStyleId = flag("--style") || styleFromArtifactName(artifactPath) || DEFAULT_STYLE_ID;
  const styleProfile = resolveStyleProfile(declaredStyleId || requestedStyleId);
  const styleIssues = declaredStyleId && declaredStyleId !== requestedStyleId
    ? [{
      severity: "warning",
      code: "style_profile_mismatch",
      field: "styleProfile.id",
      detail: `The artifact was rendered with "${declaredStyleId}" but "${requestedStyleId}" was expected.`,
    }]
    : [];
  const result = {
    ...validateRenderedArtifact({
      resume: formatterResume,
      extractedText,
      // Written beside the PDF by format-pdf. Absent for a DOCX, and absent for
      // a PDF rendered before this existed — in both cases the layout checks
      // are skipped rather than guessed, because Word repaginates a DOCX on
      // open and a measurement we did not take is not a measurement.
      layout: loadLayoutSidecar(safeArtifactPath),
      profile: styleProfile,
      linkTargets,
    }),
    styleProfile: {
      id: styleProfile.id,
      displayName: styleProfile.displayName,
      // "artifact" means the file said so; the other sources are what the
      // caller asked for, which a PDF cannot confirm on its own.
      source: declaredStyleId ? "artifact" : (flag("--style") ? "flag" : "artifact_name"),
    },
    artifactPath: path.basename(safeArtifactPath),
    artifactType: extension.slice(1),
    artifactHash: crypto.createHash("sha256").update(fs.readFileSync(safeArtifactPath)).digest("hex"),
    pageCount,
  };
  if (styleIssues.length) result.issues = [...result.issues, ...styleIssues];
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
