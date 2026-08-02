import fs from "node:fs";
import path from "node:path";

const LIMITS = {
  pdf: 50 * 1024 * 1024,
  docx: 20 * 1024 * 1024,
};

export function assertSafeDocument(filePath, type) {
  const resolved = path.resolve(filePath);
  const expectedExtension = `.${type}`;
  if (path.extname(resolved).toLowerCase() !== expectedExtension) {
    throw new Error(`Expected a ${expectedExtension} file.`);
  }

  const stats = fs.statSync(resolved);
  if (!stats.isFile()) throw new Error("Input must be a regular file.");
  if (stats.size === 0) throw new Error("Input file is empty.");
  if (stats.size > LIMITS[type]) {
    throw new Error(`${type.toUpperCase()} exceeds the ${LIMITS[type] / 1024 / 1024} MB safety limit.`);
  }

  const handle = fs.openSync(resolved, "r");
  const header = Buffer.alloc(5);
  try {
    fs.readSync(handle, header, 0, header.length, 0);
  } finally {
    fs.closeSync(handle);
  }

  if (type === "pdf" && header.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("PDF file signature is invalid.");
  }
  if (type === "docx" && !(header[0] === 0x50 && header[1] === 0x4b)) {
    throw new Error("DOCX ZIP file signature is invalid.");
  }

  return resolved;
}

