#!/usr/bin/env node
// docx-text.js — extract the raw text an ATS would parse from a DOCX.
// Usage: node src/tools/docx-text.js <path-to.docx>
import { extractTextFromDocx } from "../utils/docx-to-text.js";
import { assertSafeDocument } from "../lib/file-safety.js";

const docxPath = process.argv[2];
if (!docxPath) {
  process.stderr.write("Usage: node src/tools/docx-text.js <path-to.docx>\n");
  process.exit(1);
}

try {
  const safePath = assertSafeDocument(docxPath, "docx");
  const text = await extractTextFromDocx({ path: safePath });
  process.stdout.write(text + "\n");
} catch (err) {
  process.stderr.write(`docx-text error: ${err.message}\n`);
  process.exit(1);
}
