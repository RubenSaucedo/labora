// Locating a Chrome to render PDFs with.
//
// labora used to depend on `puppeteer`, which downloads its own Chromium on
// install: 1.9 GB, for a browser almost every machine already has. Worse, that
// download is a post-install script, and a plugin manager never runs one - so
// the bundled browser was never actually there when it was needed.
//
// `puppeteer-core` ships the automation protocol without the browser, and this
// module supplies the executable instead.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Ordered by how likely the resulting PDF is to match what a reviewer sees.
// Chrome first, then other Chromium builds, which share the same print engine.
const CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

function fromPath() {
  const names =
    process.platform === "win32"
      ? []
      : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  for (const name of names) {
    try {
      const found = execFileSync("command", ["-v", name], {
        encoding: "utf8",
        shell: "/bin/sh",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (found && fs.existsSync(found)) return found;
    } catch {
      // `command -v` exits non-zero when the name is not on PATH.
    }
  }
  return null;
}

/**
 * @returns {string|null} Absolute path to a Chrome-family executable, or null.
 */
export function findChrome() {
  // An explicit override wins, so an operator on an unusual layout - or a CI
  // image - is never blocked by this list being incomplete.
  const override = process.env.LABORA_CHROME;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(
        `LABORA_CHROME is set to ${override}, but nothing exists there.`,
      );
    }
    return override;
  }
  for (const candidate of CANDIDATES[process.platform] || []) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return fromPath();
}

/**
 * Like findChrome, but explains how to fix it instead of returning null. PDF
 * rendering is a delivery artifact, so failing loudly beats a silent skip.
 * @returns {string}
 */
export function requireChrome() {
  const found = findChrome();
  if (found) return found;
  throw new Error(
    "No Chrome or Chromium was found, so the PDF cannot be rendered.\n" +
      "labora deliberately does not download its own browser - that costs 1.9 GB\n" +
      "for a program most machines already have.\n\n" +
      "Either install Google Chrome, or point labora at an existing build:\n" +
      "  export LABORA_CHROME=/path/to/chrome\n\n" +
      "DOCX rendering does not need a browser and still works.",
  );
}
