// Reading a named part back out of a DOCX.
//
// A DOCX is a zip. mammoth gives us the body text, which is what artifact
// validation is mostly about, but it drops everything else — including the core
// properties, where the renderer records which style profile produced the file.
// Verifying that record means opening the container, so this reads the zip
// directly rather than adding a dependency for two dozen lines of format.
//
// Only the central directory is trusted: a local header may carry zeroed sizes
// with the real ones in a trailing data descriptor, and the central directory
// always has them.
import fs from "node:fs";
import zlib from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const STORED = 0;
const DEFLATED = 8;

function findEndOfCentralDirectory(buffer) {
  // The comment field is variable length, so the record is found by scanning
  // back from the end. 22 bytes is the record with an empty comment.
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

/**
 * @param {Buffer} buffer - DOCX bytes.
 * @param {string} partName - e.g. "docProps/core.xml".
 * @returns {string|null} UTF-8 contents, or null when the part is absent.
 */
export function readDocxPart(buffer, partName) {
  const end = findEndOfCentralDirectory(buffer);
  if (end < 0) throw new Error("Not a zip container: no end-of-central-directory record.");
  const entryCount = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new Error("Corrupt zip central directory.");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (name === partName) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === STORED) return data.toString("utf8");
      if (method === DEFLATED) return zlib.inflateRawSync(data).toString("utf8");
      throw new Error(`Unsupported zip compression method ${method} for ${partName}.`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/**
 * The style profile the renderer stamped into the document's own core
 * properties. A delivered file that states its visual contract can be checked
 * against the run that claims to have produced it.
 *
 * @param {{buffer?: Buffer, path?: string}} source
 * @returns {string|null}
 */
export function readDocxStyleProfileId({ buffer, path: filePath }) {
  const bytes = buffer ?? fs.readFileSync(filePath);
  const core = readDocxPart(bytes, "docProps/core.xml");
  if (!core) return null;
  const keywords = /<cp:keywords[^>]*>([\s\S]*?)<\/cp:keywords>/.exec(core)?.[1] ?? "";
  return /labora-style:([a-z0-9-]+)/i.exec(keywords)?.[1] ?? null;
}
