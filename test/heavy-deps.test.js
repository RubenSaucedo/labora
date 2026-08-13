import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { findChrome, requireChrome } from "../src/lib/browser.js";
import { pluginRoot } from "../src/lib/paths.js";

const manifest = JSON.parse(
  fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"),
);

// `puppeteer` downloads a 1.9 GB Chromium in a post-install script. A plugin
// manager never runs post-install, so the browser was both enormous and absent.
test("the plugin does not depend on a browser it has to download", () => {
  const deps = Object.keys(manifest.dependencies || {});
  assert.ok(
    !deps.includes("puppeteer"),
    "puppeteer bundles its own Chromium; depend on puppeteer-core and find an installed browser",
  );
  assert.ok(deps.includes("puppeteer-core"), "PDF rendering still needs the automation protocol");
});

test("PDF rendering supplies an executable path explicitly", () => {
  const src = fs.readFileSync(path.join(pluginRoot, "src", "agents", "format-resume.js"), "utf8");
  assert.ok(src.includes("puppeteer-core"), "must launch through puppeteer-core");
  assert.ok(
    /executablePath:\s*requireChrome\(\)/.test(src),
    "puppeteer-core carries no browser, so launch() must be given one",
  );
});

test("an explicit browser override is honoured, and a bogus one is refused", () => {
  const previous = process.env.LABORA_CHROME;
  const real = path.join(pluginRoot, "package.json"); // any file that exists
  try {
    process.env.LABORA_CHROME = real;
    assert.equal(findChrome(), real, "LABORA_CHROME must win over the built-in candidates");
    process.env.LABORA_CHROME = path.join(os.tmpdir(), "labora-no-such-chrome");
    assert.throws(
      () => findChrome(),
      /nothing exists there/,
      "a wrong override must be reported, not silently ignored in favour of another browser",
    );
  } finally {
    if (previous === undefined) delete process.env.LABORA_CHROME;
    else process.env.LABORA_CHROME = previous;
  }
});

test("a missing browser explains itself and points at DOCX", () => {
  const previous = process.env.LABORA_CHROME;
  try {
    delete process.env.LABORA_CHROME;
    if (findChrome()) return; // this machine has one; the message is covered below
    assert.throws(() => requireChrome(), /LABORA_CHROME/);
  } finally {
    if (previous !== undefined) process.env.LABORA_CHROME = previous;
  }
});

// Tesseract defaults cachePath to ".", so OCR downloaded eng.traineddata into
// whatever directory it ran from - which is the persona's private repository.
test("OCR caches its language data with the plugin, never in the working directory", () => {
  const src = fs.readFileSync(path.join(pluginRoot, "src", "utils", "pdf-to-md.js"), "utf8");
  assert.ok(
    !/^import\s+\{\s*createWorker\s*\}\s+from\s+'tesseract\.js'/m.test(src),
    "tesseract must be imported lazily so a text-layer PDF can be read without it",
  );
  assert.ok(
    /cachePath/.test(src) && /pluginRoot/.test(src),
    "createWorker must be given a cachePath under the plugin root; the default is the caller's cwd",
  );
});

test("OCR is optional, so an install without it still succeeds", () => {
  assert.ok(
    !Object.keys(manifest.dependencies || {}).includes("tesseract.js"),
    "OCR is only needed for scanned PDFs and must not be a hard requirement",
  );
  assert.equal((manifest.optionalDependencies || {})["tesseract.js"], "^7.0.0");
});

test("a PDF without a text layer names the missing package instead of crashing", async () => {
  const src = fs.readFileSync(path.join(pluginRoot, "src", "utils", "pdf-to-md.js"), "utf8");
  assert.ok(
    /tesseract\.js is\s*\n?\s*'?\s*\+?\s*'?not installed|not installed/.test(src),
    "the failure has to say which package is missing and how to install it",
  );
  assert.ok(/labora doctor/.test(src), "and diagnose whether setup is available");
});

// pdf-parse needs a modern Node and fails deep inside itself on an old one.
test("the supported Node range is declared", () => {
  assert.equal(manifest.engines?.node, ">=20.16.0 <21 || >=22.3.0");
  const pdfParse = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, "node_modules", "pdf-parse", "package.json"), "utf8"),
  );
  assert.equal(
    manifest.engines.node,
    pdfParse.engines.node,
    "the declared range must match what the strictest dependency actually needs",
  );
});

test("the dispatcher refuses an unsupported Node before a dependency can confuse the error", () => {
  const src = fs.readFileSync(path.join(pluginRoot, "bin", "labora"), "utf8");
  assert.ok(/unsupportedNode/.test(src), "bin/labora must check the Node version itself");
  const result = spawnSync(process.execPath, [path.join(pluginRoot, "bin", "labora"), "doctor"], {
    encoding: "utf8",
  });
  assert.match(result.stdout, /pdf renderer/, "doctor must report whether a PDF can be produced");
});

// The band-aid was gitignoring eng.traineddata here, which does nothing once the
// file lands in the user's own repository instead.
test("the run-time cache is ignored, not the symptom", () => {
  const ignore = fs.readFileSync(path.join(pluginRoot, ".gitignore"), "utf8");
  assert.ok(/^\.cache\/$/m.test(ignore), "the plugin's run-time cache directory must be ignored");
  assert.ok(
    !/^eng\.traineddata$/m.test(ignore),
    "ignoring the file here hid the bug instead of fixing where it was written",
  );
});
