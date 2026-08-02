#!/usr/bin/env node
/**
 * PDF to Markdown converter for career connect documents.
 * Extracts text only (ignores images), applies light structuring (headings, bullets, dates).
 * Usage: node tools/pdf-to-md.js <input.pdf> <output.md>
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';

const __filename = fileURLToPath(import.meta.url);
function isEntryScript() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === resolve(__filename);
}

/** Bullet characters we normalize to Markdown `-` */
const BULLET_CHARS = /^[\s]*[-•*·▪◦]\s+/;

/** Lines that look like a date (e.g. "January 2023", "Q1 2024", "H1 2023") */
const DATE_LIKE = /^\s*([A-Za-z]+\s+\d{4}|[QH]\d\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})\s*$/;

/** Page marker lines to drop (e.g. "-- 1 of 7 --") */
const PAGE_MARKER = /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/;

/** Short line that might be a title (e.g. "Connect – John" or "H1 2023 Connect") */
function looksLikeTitle(line, index, lines) {
  const t = line.trim();
  if (t.length > 80) return false;
  if (index > 2) return false; // only consider first few lines
  if (/^\d+$/.test(t) || /^[\.\-\s]+$/.test(t)) return false;
  if (DATE_LIKE.test(t)) return false;
  return t.length > 2;
}

/**
 * Extract raw text from PDF buffer using pdf-parse (PDFParse class).
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, numpages: number }>}
 */
export async function extractTextFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result.text ?? '', numpages: result.total ?? 0 };
  } finally {
    await parser.destroy();
  }
}

/** Minimum non-empty content length to consider text "substantial" (avoid OCR when PDF has a text layer). */
const NEGLIGIBLE_TEXT_THRESHOLD = 200;

/** Strip page marker lines and return the remaining text for length check. */
function textWithoutPageMarkers(text) {
  if (typeof text !== 'string') return '';
  return text
    .split(/\r?\n/)
    .filter((line) => !PAGE_MARKER.test(line))
    .join('\n')
    .trim();
}

/**
 * True if extracted text is negligible (empty, only page markers, or very short).
 * Used to decide whether to run OCR for image-based PDFs.
 */
export function isNegligibleText(text) {
  const stripped = textWithoutPageMarkers(text);
  return stripped.length < NEGLIGIBLE_TEXT_THRESHOLD;
}

/**
 * Extract text from an image-based PDF by rendering each page to an image and running OCR (Tesseract.js).
 * Use when getText() returns little or no content.
 * Processes one page at a time to avoid loading all pages into memory (fixes hang/OOM on multi-page image PDFs).
 * @param {Buffer} buffer - PDF file buffer
 * @param {{ numpages?: number, onProgress?: (current: number, total: number) => void }} [options] - numpages from prior getText(); if omitted, obtained via a quick getText(). onProgress called before each page OCR.
 * @returns {Promise<{ text: string, numpages: number }>}
 */
export async function extractTextFromPdfViaOcr(buffer, options = {}) {
  const { numpages: numpagesOpt, onProgress } = options;
  let numpages = numpagesOpt;
  if (numpages == null || numpages < 1) {
    const extracted = await extractTextFromPdf(buffer);
    numpages = extracted.numpages || 1;
  }

  const worker = await createWorker('eng');
  const pageTexts = [];
  const screenshotOptions = { imageBuffer: true, scale: 2 };

  try {
    for (let p = 1; p <= numpages; p++) {
      if (typeof onProgress === 'function') onProgress(p, numpages);
      let parser = new PDFParse({ data: buffer });
      try {
        const screenshotResult = await parser.getScreenshot({
          ...screenshotOptions,
          partial: [p],
        });
        await parser.destroy();
        parser = null;
        const page = screenshotResult.pages && screenshotResult.pages[0];
        const imageData = page && page.data && page.data.length > 0 ? Buffer.from(page.data) : null;
        if (!imageData) {
          pageTexts.push('');
          continue;
        }
        const { data } = await worker.recognize(imageData);
        pageTexts.push(data?.text ?? '');
      } finally {
        if (parser) await parser.destroy();
      }
    }
    const text = pageTexts.join('\n\n').trim();
    return { text, numpages };
  } finally {
    await worker.terminate();
  }
}

/**
 * Apply light structuring to raw PDF text: normalize bullets, optional title/date block.
 * @param {string} raw
 * @returns {string} Markdown string
 */
export function rawTextToMarkdown(raw) {
  const lines = raw.split(/\r?\n/);
  const out = [];
  let i = 0;
  const titleCandidates = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const nextTrimmed = i + 1 < lines.length ? lines[i + 1].trim() : '';

    // Skip empty lines at the very start
    if (out.length === 0 && !trimmed) {
      i++;
      continue;
    }

    // Skip page marker lines (e.g. "-- 1 of 7 --")
    if (PAGE_MARKER.test(line)) {
      i++;
      continue;
    }

    // Collect possible title/date in first few lines
    if (out.length <= 2 && trimmed && (looksLikeTitle(line, i, lines) || DATE_LIKE.test(trimmed))) {
      titleCandidates.push(trimmed);
      i++;
      continue;
    }

    // If we collected title candidates and now hit a blank or body line, emit "Connect Info" section
    if (titleCandidates.length > 0 && (out.length === 0 || !trimmed)) {
      out.push('## Connect Info');
      out.push('');
      for (const c of titleCandidates) {
        out.push(c);
      }
      out.push('');
      titleCandidates.length = 0;
      if (!trimmed) {
        i++;
        continue;
      }
    }

    if (!trimmed) {
      out.push('');
      i++;
      continue;
    }

    // Normalize bullet lines to Markdown `- `; preserve numbered lists as "1. "
    if (BULLET_CHARS.test(line)) {
      out.push(line.replace(BULLET_CHARS, '- ').trimStart());
    } else if (/^\s*\d+[\.\)]\s+/.test(line)) {
      out.push(trimmed); // keep "1. " or "1) " style
    } else {
      out.push(trimmed);
    }
    i++;
  }

  if (titleCandidates.length > 0) {
    out.push('## Connect Info');
    out.push('');
    for (const c of titleCandidates) {
      out.push(c);
    }
    out.push('');
  }

  // Collapse multiple blank lines to at most one, trim trailing blanks
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

/** True if the string is empty or only whitespace. */
function isBlank(s) {
  return typeof s !== 'string' || s.trim().length === 0;
}

/**
 * Convert a PDF file to Markdown and write to output path.
 * When the PDF has no or negligible text (e.g. image-based), OCR is used automatically
 * unless you pass forceOcr: true to skip the initial text extraction.
 * @param {string} inputPath - Path to PDF file
 * @param {string} outputPath - Path to write .md file
 * @param {{ forceOcr?: boolean }} [options] - forceOcr: use OCR only (skip getText)
 * @returns {Promise<{ numpages: number, usedOcr?: boolean }>}
 */
export async function convertPdfToMd(inputPath, outputPath, options = {}) {
  const { forceOcr = false } = options;
  const inputAbs = resolve(inputPath);
  const outputAbs = resolve(outputPath);
  const buffer = readFileSync(inputAbs);

  let text = '';
  let numpages = 0;
  let usedOcr = false;

  if (forceOcr) {
    if (process.stderr) process.stderr.write('Using OCR (--ocr) for all pages…\n');
    const ocrResult = await extractTextFromPdfViaOcr(buffer, {
      onProgress: (current, total) => {
        if (process.stderr) process.stderr.write(`OCR page ${current}/${total}…\n`);
      },
    });
    text = ocrResult.text;
    numpages = ocrResult.numpages;
    usedOcr = true;
  } else {
    const extracted = await extractTextFromPdf(buffer);
    text = extracted.text;
    numpages = extracted.numpages;
    if (isNegligibleText(text)) {
      if (process.stderr) process.stderr.write(`Using OCR for ${numpages} page(s)…\n`);
      try {
        const ocrResult = await extractTextFromPdfViaOcr(buffer, {
          numpages,
          onProgress: (current, total) => {
            if (process.stderr) process.stderr.write(`OCR page ${current}/${total}…\n`);
          },
        });
        text = ocrResult.text;
        numpages = ocrResult.numpages;
        usedOcr = true;
      } catch (err) {
        if (process.stderr) process.stderr.write(`OCR failed: ${err.message}; keeping original text.\n`);
      }
    }
  }

  const md = rawTextToMarkdown(text);

  let toWrite = md;
  if (isBlank(toWrite)) {
    if (isBlank(text)) {
      toWrite =
        '<!-- No text was extracted from this PDF. It may be image-based (scanned); consider re-export with a text layer or check OCR. -->\n';
    } else {
      toWrite =
        '<!-- Only page markers or minimal text were extracted; raw output below. -->\n\n## Raw extracted text\n\n' +
        text.trim() +
        '\n';
    }
  }

  mkdirSync(dirname(outputAbs), { recursive: true });
  writeFileSync(outputAbs, toWrite + '\n', 'utf8');
  return { numpages, usedOcr };
}

function main() {
  const args = process.argv.slice(2);
  const forceOcr = args.includes('--ocr');
  const positional = args.filter((a) => a !== '--ocr');
  if (positional.length < 2) {
    process.stderr.write('Usage: node src/utils/pdf-to-md.js <input.pdf> <output.md> [--ocr]\n');
    process.stderr.write('  --ocr  Force OCR for all pages (skip text extraction).\n');
    process.exit(1);
  }
  const [inputPath, outputPath] = positional;
  convertPdfToMd(inputPath, outputPath, { forceOcr })
    .then(({ numpages, usedOcr }) => {
      process.stderr.write(`Converted ${inputPath} (${numpages} page(s)) -> ${outputPath}${usedOcr ? ' [OCR]' : ''}\n`);
    })
    .catch((err) => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    });
}

if (isEntryScript()) {
  main();
}
