/**
 * Extract plain text from a .docx file (for ATS parsing, HR judge, etc.).
 * Uses mammoth; returns the text as an ATS or human would see it after parsing the document.
 */
import mammoth from "mammoth";

/**
 * @param {{ path?: string, buffer?: Buffer }} input - Path to .docx file or buffer
 * @returns {Promise<string>} Plain text content
 */
export async function extractTextFromDocx({ path: filePath, buffer }) {
  const options = {};
  if (filePath) {
    const result = await mammoth.extractRawText({ path: filePath, ...options });
    return result.value || "";
  }
  if (buffer && Buffer.isBuffer(buffer)) {
    const result = await mammoth.extractRawText({ buffer, ...options });
    return result.value || "";
  }
  throw new Error("extractTextFromDocx requires path or buffer");
}

/**
 * Independent second view of a .docx via mammoth's document-to-HTML conversion
 * (style map + structural walk) rather than the raw-text extractor. Exercising a
 * different code path surfaces content one path recovers and the other drops —
 * the basis of the cross-parser divergence check.
 *
 * @param {{ path?: string, buffer?: Buffer }} input
 * @returns {Promise<string>} Plain text derived from the HTML rendering
 */
export async function extractHtmlTextFromDocx({ path: filePath, buffer }) {
  const input = filePath ? { path: filePath } : (buffer && Buffer.isBuffer(buffer) ? { buffer } : null);
  if (!input) throw new Error("extractHtmlTextFromDocx requires path or buffer");
  const result = await mammoth.convertToHtml(input);
  return (result.value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * List the external hyperlink targets a Word-compatible reader would find in a
 * .docx. Used to tell a link that renders as clickable from one that was
 * flattened to text — a distinction no plain-text extraction can make.
 *
 * @param {{ path?: string, buffer?: Buffer }} input
 * @returns {Promise<string[]>} Unique absolute URLs, in document order
 */
export async function extractLinkTargetsFromDocx({ path: filePath, buffer }) {
  const input = filePath ? { path: filePath } : (buffer && Buffer.isBuffer(buffer) ? { buffer } : null);
  if (!input) throw new Error("extractLinkTargetsFromDocx requires path or buffer");
  const result = await mammoth.convertToHtml(input);
  const targets = [];
  for (const match of (result.value || "").matchAll(/<a\s+href="([^"]*)"/g)) {
    const href = match[1].replace(/&amp;/g, "&").trim();
    // mailto: and tel: are contact rendering, already covered by field recall.
    if (!/^https?:\/\//i.test(href)) continue;
    if (!targets.includes(href)) targets.push(href);
  }
  return targets;
}
