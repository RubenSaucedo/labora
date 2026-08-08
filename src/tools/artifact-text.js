#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { assertSafeDocument } from "../lib/file-safety.js";
import { extractTextFromDocx } from "../utils/docx-to-text.js";
import { extractTextFromPdf } from "../utils/pdf-to-md.js";

const artifactPath = process.argv[2];
if (!artifactPath) {
  process.stderr.write("Usage: labora artifact-text <resume.docx|resume.pdf>\n");
  process.exit(1);
}

try {
  const extension = path.extname(artifactPath).toLowerCase();
  if (extension === ".docx") {
    const safePath = assertSafeDocument(artifactPath, "docx");
    process.stdout.write(`${await extractTextFromDocx({ path: safePath })}\n`);
  } else if (extension === ".pdf") {
    const safePath = assertSafeDocument(artifactPath, "pdf");
    const result = await extractTextFromPdf(fs.readFileSync(safePath));
    process.stdout.write(`${result.text || ""}\n`);
  } else {
    throw new Error("Artifact must be DOCX or PDF.");
  }
} catch (error) {
  process.stderr.write(`artifact-text error: ${error.message}\n`);
  process.exit(1);
}

