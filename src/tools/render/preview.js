#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";
import { assertSafeDocument, assertNotAFlag } from "../../lib/file-safety.js";

/** Read the measured page fill format-pdf wrote next to the artifact, if any. */
function loadLayoutSidecar(artifactPath) {
  const sidecar = `${artifactPath}.layout.json`;
  if (!fs.existsSync(sidecar)) return null;
  try {
    return JSON.parse(fs.readFileSync(sidecar, "utf8"));
  } catch {
    return null;
  }
}

const pdfPath = process.argv[2];
const outputDir = process.argv[3];

if (!pdfPath || !outputDir) {
  process.stderr.write(
    "Usage: labora render preview <resume.pdf> <output-dir>\n"
  );
  process.exit(1);
}

try {
  assertNotAFlag(pdfPath, "PDF path");
  assertNotAFlag(outputDir, "Output directory");
  const safePath = assertSafeDocument(pdfPath, "pdf");
  const buffer = fs.readFileSync(safePath);
  const sourceArtifactHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const preflight = new PDFParse({ data: buffer });
  let pageCount = 0;
  try {
    pageCount = (await preflight.getText()).total || 0;
  } finally {
    await preflight.destroy();
  }
  if (pageCount < 1 || pageCount > 10) {
    throw new Error(`Preview requires 1-10 pages; found ${pageCount}.`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  for (const entry of fs.readdirSync(outputDir)) {
    if (/^page-\d+\.png$/.test(entry)) fs.unlinkSync(path.join(outputDir, entry));
  }

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const parser = new PDFParse({ data: buffer });
    try {
      const screenshot = await parser.getScreenshot({
        imageBuffer: true,
        scale: 1.5,
        partial: [pageNumber],
      });
      const page = screenshot.pages?.[0];
      if (!page?.data?.length) throw new Error(`Could not render page ${pageNumber}.`);
      const outputPath = path.join(
        outputDir,
        `page-${String(pageNumber).padStart(2, "0")}.png`
      );
      const pageBuffer = Buffer.from(page.data);
      fs.writeFileSync(outputPath, pageBuffer);
      pages.push({
        file: path.basename(outputPath),
        hash: crypto.createHash("sha256").update(pageBuffer).digest("hex"),
      });
    } finally {
      await parser.destroy();
    }
  }
  const manifest = {
    schemaVersion: "1.0",
    sourceArtifact: path.basename(safePath),
    sourceArtifactHash,
    pageCount,
    // Measured at render time by format-pdf, not re-derived here: a page image
    // shows how full a page looks, but only the layout pass knows by how much.
    layout: loadLayoutSidecar(safePath),
    pages,
  };
  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
} catch (error) {
  process.stderr.write(`render-artifact-preview error: ${error.message}\n`);
  process.exit(1);
}
