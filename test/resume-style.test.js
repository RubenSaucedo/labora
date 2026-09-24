import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_STYLE_ID,
  contactRows,
  cssStyleTokens,
  docxStyleTokens,
  inchesToTwips,
  linkHref,
  listStyleProfiles,
  ptToEighths,
  ptToHalfPoints,
  pxToTwips,
  resolveStyleProfile,
  styleProfileIds,
  styleTokens,
} from "../src/lib/resume-style.js";
import { ZResumeStyleProfile, parseResumeStyleProfile } from "../src/schemas/resume-style.js";
import { pluginRoot } from "../src/lib/paths.js";

const BUILT_IN_IDS = ["editorial-technical", "precision-minimal"];

// Synthetic contact values only: a style profile never stores a person's
// details, and neither does a fixture in a public repository.
const SYNTHETIC_HEADER = {
  location: "Seattle, WA",
  email: "jane@example.test",
  phone: "+1 555-0100",
  linkedin: "linkedin.com/in/jane-example",
  github: "github.com/jane-example",
  portfolio: "jane.example",
};

test("the registry ships exactly the two reviewed profiles", () => {
  assert.deepEqual(styleProfileIds(), BUILT_IN_IDS);
  assert.equal(DEFAULT_STYLE_ID, "precision-minimal");
  assert.deepEqual(
    listStyleProfiles().map((profile) => profile.displayName),
    ["Editorial Technical", "Precision Minimal"]
  );
});

// The registry imports nothing, so its shape is enforced here rather than at
// load. If the two ever disagree, this is where it surfaces.
test("every built-in profile satisfies the style schema", () => {
  for (const id of styleProfileIds()) {
    const parsed = ZResumeStyleProfile.safeParse(resolveStyleProfile(id));
    assert.equal(parsed.success, true, `${id}: ${parsed.error?.message ?? ""}`);
  }
});

test("the schema refuses a profile that cannot be rendered consistently", () => {
  const valid = resolveStyleProfile("precision-minimal");

  assert.throws(
    () => parseResumeStyleProfile({ ...valid, colors: { ...valid.colors, rule: "slate" } }),
    /colors\.rule/,
    "colours must be hex so DOCX and CSS derive from one value"
  );
  assert.throws(
    () => parseResumeStyleProfile({ ...valid, id: "Precision Minimal" }),
    /id/,
    "IDs are stable kebab-case names, not display strings"
  );
  assert.throws(
    () => parseResumeStyleProfile({ ...valid, fonts: { body: ["Arial"], display: valid.fonts.display } }),
    /fonts\.body/,
    "a font stack needs a fallback"
  );
  assert.throws(
    () => parseResumeStyleProfile({ ...valid, contactRows: [["location", "fax"]] }),
    /contactRows/,
    "a contact row can only group known header fields"
  );
  assert.throws(
    () => parseResumeStyleProfile({ ...valid, sections: ["Summary", "Experience"] }),
    /sections/,
    "a style may not describe content; section order is not a style decision"
  );
});

test("both named profiles resolve deterministically", () => {
  for (const id of BUILT_IN_IDS) {
    const first = resolveStyleProfile(id);
    const second = resolveStyleProfile(id);
    assert.equal(first.id, id);
    assert.deepEqual(first, second);
    assert.deepEqual(docxStyleTokens(id), docxStyleTokens(id));
    assert.deepEqual(cssStyleTokens(id), cssStyleTokens(id));
    assert.throws(() => {
      resolveStyleProfile(id).sizes.body = 99;
    }, "a resolved profile is frozen so one render cannot mutate the registry");
  }
});

test("an unknown style fails with the accepted values instead of falling back", () => {
  for (const unknown of ["1", "4", "precision_minimal", "", "Editorial Technical"]) {
    assert.throws(
      () => resolveStyleProfile(unknown),
      (error) => {
        assert.match(error.message, /Unknown resume style/);
        for (const id of BUILT_IN_IDS) assert.ok(error.message.includes(id));
        return true;
      },
      `"${unknown}" must be refused`
    );
  }
});

test("grouped renderer CLIs refuse an unknown style with a non-zero exit", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "labora-style-"));
  const resume = path.join(pluginRoot, "data/personas/example/applications/acme-senior-fe-mar-25/resume.json");
  const contact = path.join(pluginRoot, "data/personas/example/profile/contact.md");
  const job = path.join(pluginRoot, "data/personas/example/applications/acme-senior-fe-mar-25/job.md");
  const cases = [
    { command: ["render", "resume", resume, "--out", out, "--contact", contact, "--job", job] },
  ];
  for (const { command } of cases) {
    const result = spawnSync(
      process.execPath,
      [path.join(pluginRoot, "bin", "labora"), ...command, "--style", "2"],
      { cwd: pluginRoot, encoding: "utf8" }
    );
    assert.notEqual(result.status, 0, `${command.slice(0, 2).join(" ")} must exit non-zero`);
    assert.match(result.stderr, /Unknown resume style "2"/, command.join(" "));
    for (const id of BUILT_IN_IDS) {
      assert.ok(result.stderr.includes(id), `${command.join(" ")} must list ${id}`);
    }
  }
});

test("both renderers read the same semantic tokens from one profile", () => {
  for (const id of BUILT_IN_IDS) {
    const { profile, docx, css } = styleTokens(id);

    assert.deepEqual(Object.keys(docx.sizes), Object.keys(profile.sizes));
    assert.deepEqual(Object.keys(css.sizes), Object.keys(profile.sizes));
    assert.deepEqual(Object.keys(docx.spacing), Object.keys(css.spacing));
    assert.deepEqual(Object.keys(docx.colors), Object.keys(profile.colors));

    for (const [key, pt] of Object.entries(profile.sizes)) {
      assert.equal(docx.sizes[key], ptToHalfPoints(pt), `${id}.${key} half-points`);
      assert.equal(css.sizes[key], `${pt}pt`, `${id}.${key} CSS`);
    }
    for (const [key, hex] of Object.entries(profile.colors)) {
      assert.equal(docx.colors[key], hex.replace("#", "").toUpperCase());
      assert.equal(css.colors[key], hex);
    }
    assert.equal(docx.spacing.section, pxToTwips(profile.spacing.sectionPx));
    assert.equal(css.spacing.section, `${profile.spacing.sectionPx}px`);
    assert.equal(docx.spacing.bullet, pxToTwips(profile.spacing.bulletPx));
    assert.equal(docx.margin, inchesToTwips(profile.page.marginInches));
    assert.equal(css.margin, `${profile.page.marginInches}in`);
    assert.equal(docx.sectionRule.size, ptToEighths(profile.sectionRule.thicknessPt));
    assert.equal(css.sectionRule.border.includes(profile.colors.rule), true);
    assert.equal(docx.positioning.italics, profile.positioning.italic);
    assert.equal(css.positioning.style, profile.positioning.italic ? "italic" : "normal");
    assert.deepEqual(docx.pagination, css.pagination);
  }
});

// Word cannot represent 10.15pt: it stores half-points as integers. The
// conversion is stated rather than accidental, so the two renderers differ by a
// documented rounding instead of by a hand-tuned constant.
test("unit conversion rounds where DOCX cannot hold the CSS value", () => {
  assert.equal(ptToHalfPoints(10), 20);
  assert.equal(ptToHalfPoints(10.15), 20);
  assert.equal(ptToHalfPoints(9.35), 19);
  assert.equal(pxToTwips(13), 195);
  assert.equal(pxToTwips(3.5), 53);
  assert.equal(inchesToTwips(0.65), 936);
  assert.equal(inchesToTwips(0.7), 1008);

  const editorial = resolveStyleProfile("editorial-technical");
  assert.equal(cssStyleTokens(editorial).sizes.body, "10.15pt", "CSS keeps the exact size");
  assert.equal(docxStyleTokens(editorial).sizes.body, 20, "DOCX takes the nearest half-point");
});

test("display and body fonts may differ, and each renderer gets the right form", () => {
  const precision = styleTokens("precision-minimal");
  const editorial = styleTokens("editorial-technical");

  assert.equal(precision.docx.fontBody, precision.docx.fontDisplay);
  assert.notEqual(editorial.docx.fontBody, editorial.docx.fontDisplay);
  assert.equal(editorial.docx.fontDisplay, "Georgia");
  assert.equal(editorial.css.fontDisplay, "Georgia, Times New Roman, serif");
  assert.equal(editorial.css.fontBody, "Arial, Helvetica, sans-serif");
  // Word names one family, so the stack's first entry has to be a real font.
  assert.equal(editorial.docx.fontBody, editorial.profile.fonts.body[0]);
});

test("contact rows group deterministically and carry their links", () => {
  for (const id of BUILT_IN_IDS) {
    const rows = contactRows(SYNTHETIC_HEADER, id);
    assert.deepEqual(rows.map((row) => row.map((item) => item.key)), [
      ["location", "email", "phone"],
      ["linkedin", "github", "portfolio"],
    ]);
    assert.deepEqual(rows.map((row) => row.map((item) => item.text).join(" | ")), [
      "Seattle, WA | jane@example.test | +1 555-0100",
      "linkedin.com/in/jane-example | github.com/jane-example | jane.example",
    ]);
    assert.deepEqual(rows.flat().map((item) => item.href), [
      null,
      "mailto:jane@example.test",
      null,
      "https://linkedin.com/in/jane-example",
      "https://github.com/jane-example",
      "https://jane.example",
    ]);
  }
});

test("a missing contact field collapses within its row, never across rows", () => {
  const rows = contactRows({ ...SYNTHETIC_HEADER, email: "", github: "   " });
  assert.deepEqual(rows.map((row) => row.map((item) => item.key)), [
    ["location", "phone"],
    ["linkedin", "portfolio"],
  ]);
  assert.deepEqual(contactRows({ location: "Seattle, WA" }).length, 1);
  assert.deepEqual(contactRows({}), []);
});

test("only real destinations become links", () => {
  assert.equal(linkHref("https://example.test/a"), "https://example.test/a");
  assert.equal(linkHref("example.test/a"), "https://example.test/a");
  assert.equal(linkHref("Seattle, WA"), null);
  assert.equal(linkHref(""), null);
  assert.equal(linkHref(undefined), null);
});
