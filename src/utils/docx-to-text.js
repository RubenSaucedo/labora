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
