import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { lintPersonaLayout } from "../src/lib/lint-workspace.js";
import {
  AUTHORED_PROFILE_FILES,
  EVIDENCE_SHAPES,
  PERSONA_DIRECTORIES,
  isBareDateSegment,
  isBareYearSegment,
  isDatedSubjectSegment,
  isKebabCase,
} from "../src/lib/workspace-layout.js";

function persona(dirs = [], files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-layout-"));
  fs.mkdirSync(path.join(root, "profile"), { recursive: true });
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, "utf-8");
  }
  return root;
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

test("a persona that follows the contract reports nothing to fix", () => {
  const root = persona(
    ["evidence/performance-reviews/2024-10-mid-year-review", "applications/some-job"],
    { "profile/background.md": "# Background\n", "profile/contact.md": "# Contact\n" }
  );
  const result = lintPersonaLayout(root);
  assert.equal(result.warningCount, 0, JSON.stringify(result.findings, null, 2));
});

test("a bare year directory is flagged, because it does not say which year it means", () => {
  const root = persona(["evidence/performance-reviews/2025"]);
  const result = lintPersonaLayout(root);
  const found = result.findings.find((f) => f.code === "bare_year_segment");
  assert.ok(found, JSON.stringify(codes(result)));
  assert.equal(found.severity, "warning");
  assert.equal(found.location, "evidence/performance-reviews/2025");
  assert.match(found.route, /2025-03-annual-review/);
});

test("a date with no subject is flagged, because the directory cannot be identified without opening it", () => {
  const root = persona(["evidence/references/2024-10-05"]);
  const result = lintPersonaLayout(root);
  const found = result.findings.find((f) => f.code === "date_without_subject");
  assert.ok(found, JSON.stringify(codes(result)));
  assert.match(found.route, /2024-10-05-<subject>/);
});

test("processing-stage evidence is recognised, never reported as a defect", () => {
  const root = persona([
    "evidence/performance-reviews/raw",
    "evidence/performance-reviews/extracted",
    "evidence/performance-reviews/text",
    "evidence/performance-reviews/validations",
  ]);
  const result = lintPersonaLayout(root);
  const found = result.findings.find((f) => f.code === "processing_stage_layout");
  assert.ok(found, JSON.stringify(codes(result)));
  assert.equal(found.severity, "info");
  assert.equal(result.warningCount, 0);
});

test("stage directories are not each re-reported as undated evidence items", () => {
  const root = persona(["evidence/performance-reviews/raw", "evidence/performance-reviews/text"]);
  const result = lintPersonaLayout(root);
  assert.equal(codes(result).filter((c) => c === "processing_stage_layout").length, 1);
  assert.equal(codes(result).filter((c) => c === "non_kebab_segment").length, 0);
});

test("a non-kebab-case evidence type is flagged and routed away from a hand rename", () => {
  const root = persona(["evidence/Performance_Reviews"]);
  const result = lintPersonaLayout(root);
  const found = result.findings.find((f) => f.code === "non_kebab_segment");
  assert.ok(found, JSON.stringify(codes(result)));
  assert.match(found.route, /re-anchors every claim/);
});

test("generated profile state is reported as an observation, not a warning", () => {
  const root = persona(["profile/generated"]);
  const result = lintPersonaLayout(root);
  const found = result.findings.find((f) => f.code === "generated_state_in_authored_tree");
  assert.ok(found);
  assert.equal(found.severity, "info");
  assert.equal(result.warningCount, 0);
});

test("an undeclared top-level directory is reported so the operator knows no stage reads it", () => {
  const root = persona(["notes"]);
  const result = lintPersonaLayout(root);
  const found = result.findings.find((f) => f.code === "undeclared_directory");
  assert.ok(found);
  assert.equal(found.severity, "info");
  assert.match(found.route, /applications/);
});

test("dot-directories are ignored, so tooling state is never mistaken for persona data", () => {
  const root = persona([".labora/state", ".git"]);
  const result = lintPersonaLayout(root);
  assert.equal(codes(result).filter((c) => c === "undeclared_directory").length, 0);
});

test("a file beside the authored profile sources is named, with the authored set spelled out", () => {
  const root = persona([], { "profile/notes.md": "scratch\n" });
  const result = lintPersonaLayout(root);
  const found = result.findings.find((f) => f.code === "undeclared_profile_file");
  assert.ok(found);
  for (const authored of AUTHORED_PROFILE_FILES) assert.match(found.route, new RegExp(authored));
});

test("every authored profile file is accepted without comment", () => {
  const files = Object.fromEntries(AUTHORED_PROFILE_FILES.map((name) => [`profile/${name}`, "x\n"]));
  const result = lintPersonaLayout(persona([], files));
  assert.equal(codes(result).filter((c) => c === "undeclared_profile_file").length, 0);
});

test("every finding carries a route, because a gap without a next step is unfinished work", () => {
  const root = persona(["evidence/performance-reviews/2025", "evidence/Bad_Name", "notes", "profile/generated"]);
  const result = lintPersonaLayout(root);
  assert.ok(result.findings.length >= 4);
  for (const f of result.findings) {
    assert.ok(f.route && f.route.trim().length > 0, `${f.code} has no route`);
    assert.ok(["warning", "info"].includes(f.severity), `${f.code} has severity ${f.severity}`);
  }
});

test("exactly one evidence shape is preferred, and the contract says which", () => {
  const preferred = EVIDENCE_SHAPES.filter((shape) => shape.preferred);
  assert.equal(preferred.length, 1);
  assert.equal(lintPersonaLayout(persona()).preferredEvidenceShape, preferred[0].example);
});

test("every declared persona directory states who owns it", () => {
  for (const entry of PERSONA_DIRECTORIES) {
    assert.ok(["authored", "generated", "captured"].includes(entry.ownership), entry.name);
    assert.ok(entry.purpose.length > 0, entry.name);
  }
});

test("segment predicates separate a bare year from a date from a dated subject", () => {
  assert.ok(isBareYearSegment("2025"));
  assert.ok(!isBareYearSegment("2025-03"));
  assert.ok(isBareDateSegment("2025-03-01"));
  assert.ok(!isBareDateSegment("2025-03-annual-review"));
  assert.ok(isDatedSubjectSegment("2025-03-annual-review"));
  assert.ok(!isDatedSubjectSegment("annual-review"));
  assert.ok(isKebabCase("performance-reviews"));
  assert.ok(!isKebabCase("Performance_Reviews"));
});

test("the committed example persona satisfies its own contract", () => {
  const example = path.join(process.cwd(), "data", "personas", "example");
  if (!fs.existsSync(example)) return;
  const result = lintPersonaLayout(example);
  assert.equal(result.warningCount, 0, JSON.stringify(result.findings, null, 2));
});
