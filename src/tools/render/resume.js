#!/usr/bin/env node
// labora render resume — produce exactly the artifacts you asked for.
//
// This used to be three tools that each rendered one format and each demanded a
// job description. That made "give me just a DOCX" impossible to say, and it
// made a general résumé -- one not aimed at any posting -- impossible to
// render at all. Both are ordinary things to want.
//
// So: one command, `--formats` chooses what gets built, and `--job` is
// optional. A missing Chrome installation now costs you the PDF and nothing
// else, instead of failing the whole render.
import fs from "node:fs";
import path from "node:path";
import {
  agent2ResumeToFormatterJson,
  formatResumeToDocxBuffer,
  formatResumeToPdfWithLayout,
  resumeJsonToMarkdown,
} from "../../agents/format-resume.js";
import { loadJobFromFile } from "../../lib/job-parser.js";
import { injectContact, loadContact } from "../../lib/profile-contact.js";
import { DEFAULT_STYLE_ID, listStyleProfiles, resolveStyleProfile } from "../../lib/resume-style.js";
import { readResume } from "../../schemas/resume.js";

const KNOWN_FORMATS = ["md", "docx", "pdf"];
// Markdown and DOCX by default. PDF is opt-in because it needs a Chrome
// installation, and a machine without one should not look like a broken résumé.
const DEFAULT_FORMATS = ["md", "docx"];

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : fallback;
}

function styleHelp() {
  return listStyleProfiles()
    .map((profile) => `  ${profile.id.padEnd(20)} ${profile.displayName} — ${profile.signal}`)
    .join("\n");
}

function usage() {
  process.stderr.write(
    "Usage: labora render resume <resume.json> --out <dir> [--formats md,docx,pdf]\n" +
    "         [--contact <contact.md>] [--job <job.md>] [--style ID] [--name <basename>]\n" +
    "         [--max-skills N]\n\n" +
    `Formats (default ${DEFAULT_FORMATS.join(",")}): ${KNOWN_FORMATS.join(", ")}\n` +
    `Styles  (default ${DEFAULT_STYLE_ID}):\n${styleHelp()}\n`
  );
  process.exit(1);
}

const resumePath = process.argv[2];
if (!resumePath || resumePath.startsWith("--")) usage();

const outDir = flag("--out");
if (!outDir) usage();

const requested = (flag("--formats") || DEFAULT_FORMATS.join(","))
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

const unknown = requested.filter((format) => !KNOWN_FORMATS.includes(format));
if (unknown.length) {
  process.stderr.write(
    `render resume: unknown format(s): ${unknown.join(", ")}. Known formats: ${KNOWN_FORMATS.join(", ")}.\n`
  );
  process.exit(1);
}

try {
  // An unknown style is refused rather than quietly replaced: a résumé rendered
  // under a profile nobody picked carries a visual contract nobody looked at.
  const style = resolveStyleProfile(flag("--style", DEFAULT_STYLE_ID)).id;
  const maxSkills = Number.parseInt(flag("--max-skills", "15"), 10) || 15;
  const basename = flag("--name", "resume");

  let resume = readResume(JSON.parse(fs.readFileSync(resumePath, "utf8")));

  // Contact is injected at render time and only at render time, so the stored
  // document never carries it.
  const contactPath = flag("--contact");
  if (contactPath) resume = injectContact(resume, loadContact(contactPath));

  // Optional. Rendering a résumé that is not aimed at any particular posting is
  // a normal thing to do, and used to be impossible.
  const jobPath = flag("--job");
  const job = jobPath ? loadJobFromFile(jobPath) : null;

  const formatterJson = agent2ResumeToFormatterJson(resume, { job, maxSkills });
  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  const skipped = [];

  if (requested.includes("md")) {
    const target = path.join(outDir, `${basename}.md`);
    fs.writeFileSync(target, resumeJsonToMarkdown(formatterJson, style), "utf8");
    written.push(target);
  }

  if (requested.includes("docx")) {
    const target = path.join(outDir, `${basename}.docx`);
    fs.writeFileSync(target, await formatResumeToDocxBuffer({ resumeJson: formatterJson, style }));
    written.push(target);
  }

  if (requested.includes("pdf")) {
    const target = path.join(outDir, `${basename}.pdf`);
    try {
      const result = await formatResumeToPdfWithLayout({ resumeJson: formatterJson, style });
      fs.writeFileSync(target, result.buffer);
      // Page fill can only be measured while the page is still laid out in
      // Chromium, so it is recorded beside the artifact rather than guessed
      // later from the finished file.
      fs.writeFileSync(`${target}.layout.json`, `${JSON.stringify(result.layout, null, 2)}\n`);
      written.push(target);
    } catch (error) {
      // One missing browser must not cost you the formats that did render.
      skipped.push({ format: "pdf", reason: error.message });
    }
  }

  for (const target of written) process.stdout.write(`${target}\n`);
  for (const entry of skipped) {
    process.stderr.write(
      `render resume: skipped ${entry.format} — ${entry.reason}\n` +
      "The other requested formats were written. Run `labora doctor` to check the PDF renderer.\n"
    );
  }
  // Nothing requested was produced at all: that is a real failure.
  if (!written.length) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`render resume error: ${error.message}\n`);
  process.exit(1);
}
