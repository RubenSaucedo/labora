#!/usr/bin/env node
// pdf-text.js — mechanically extract text from a PDF (with automatic OCR for
// scanned/image PDFs). This is the deterministic bridge: Copilot's `view` tool
// cannot parse PDF bytes, so a skill calls this to get the raw text it can then
// faithfully clean. Extraction only — it never rewrites or interprets content.
//
// Usage:
//   labora pdf-text <input.pdf> [output.md] [--ocr] [--metadata output.json]
//   - output.md omitted -> prints extracted text to stdout
//   - --ocr             -> force OCR on every page (skip the text-layer pass)
import crypto from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import {
  extractTextFromPdf,
  extractTextFromPdfViaOcr,
  isNegligibleText,
  rawTextToMarkdown,
} from "../utils/pdf-to-md.js";
import { assertSafeDocument } from "../lib/file-safety.js";

const args = process.argv.slice(2);
let forceOcr = false;
let metadataPath = null;
const positional = [];
for (let index = 0; index < args.length; index++) {
  const value = args[index];
  if (value === "--ocr") {
    forceOcr = true;
  } else if (value === "--metadata") {
    metadataPath = args[index + 1] || null;
    if (!metadataPath || metadataPath.startsWith("--")) {
      process.stderr.write("pdf-text error: --metadata requires an output path.\n");
      process.exit(1);
    }
    index++;
  } else if (value.startsWith("--")) {
    process.stderr.write(`pdf-text error: unknown option ${value}.\n`);
    process.exit(1);
  } else {
    positional.push(value);
  }
}
const inputPath = positional[0];
const outputPath = positional[1];

if (!inputPath) {
  process.stderr.write(
    "Usage: labora pdf-text <input.pdf> [output.md] [--ocr] [--metadata output.json]\n"
  );
  process.exit(1);
}
if (metadataPath && !outputPath) {
  process.stderr.write("pdf-text error: --metadata requires output.md.\n");
  process.exit(1);
}

try {
  const safePath = assertSafeDocument(inputPath, "pdf");
  const buffer = readFileSync(safePath);
  let text = "";
  let numpages = 0;
  let usedOcr = false;

  if (forceOcr) {
    const preflight = await extractTextFromPdf(buffer);
    if (preflight.numpages > 100) throw new Error("PDF exceeds the 100-page processing limit.");
    const r = await extractTextFromPdfViaOcr(buffer, {
      numpages: preflight.numpages,
      onProgress: (c, t) => process.stderr.write(`OCR page ${c}/${t}…\n`),
    });
    text = r.text;
    numpages = r.numpages;
    usedOcr = true;
  } else {
    const extracted = await extractTextFromPdf(buffer);
    text = extracted.text;
    numpages = extracted.numpages;
    if (numpages > 100) throw new Error("PDF exceeds the 100-page processing limit.");
    if (isNegligibleText(text)) {
      const r = await extractTextFromPdfViaOcr(buffer, {
        numpages,
        onProgress: (c, t) => process.stderr.write(`OCR page ${c}/${t}…\n`),
      });
      text = r.text;
      numpages = r.numpages;
      usedOcr = true;
    }
  }

  const md = rawTextToMarkdown(text) || text.trim();

  if (outputPath) {
    const out = resolve(outputPath);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, md + "\n", "utf-8");
    if (metadataPath) {
      const metadataOut = resolve(metadataPath);
      mkdirSync(dirname(metadataOut), { recursive: true });
      writeFileSync(metadataOut, JSON.stringify({
        schemaVersion: "1.0",
        sourcePath: resolve(safePath),
        sourceHash: crypto.createHash("sha256").update(buffer).digest("hex"),
        extractedPath: out,
        extractedHash: crypto.createHash("sha256").update(md + "\n").digest("hex"),
        pageCount: numpages,
        usedOcr,
        extractedAt: new Date().toISOString(),
      }, null, 2) + "\n");
    }
    process.stderr.write(
      `Extracted ${inputPath} (${numpages} page(s)${usedOcr ? ", OCR" : ""}) -> ${out}\n`
    );
  } else {
    process.stderr.write(
      `# extracted ${numpages} page(s)${usedOcr ? " via OCR (scanned PDF — expect some noise)" : ""}\n`
    );
    process.stdout.write(md + "\n");
  }
} catch (err) {
  process.stderr.write(`pdf-text error: ${err.message}\n`);
  process.exit(1);
}
