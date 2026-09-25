import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { lintPersonaLayout } from "../src/lib/lint-workspace.js";
import {
  AUTHORED_PROFILE_FILES,
  LEGACY_SOURCES_DIR,
  OWNERSHIP,
  PERSONA_DIRECTORIES,
  RETIRED_GENERATED_DIRS,
  isBareDateSegment,
  isBareYearSegment,
  isDatedSubjectSegment,
  isKebabCase,
} from "../src/lib/workspace-layout.js";

function persona(dirs = [], files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-layout-"));
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, "utf-8");
  }
  return root;
}

function completeProfileFiles() {
  return Object.fromEntries(AUTHORED_PROFILE_FILES.map((name) => [`profile/${name}`, "x\n"]));
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

test("a persona that follows the current contract reports nothing to fix", () => {
  const root = persona(["profile", "sources", "applications/some-job", "job-search/2026-07-29"], completeProfileFiles());
  const result = lintPersonaLayout(root);
  assert.deepEqual(result.findings, []);
  assert.equal(result.schemaVersion, "2.0");
});

test("missing profile/ is advisory and routes to workspace init", () => {
  const result = lintPersonaLayout(persona());
  const found = result.findings.find((f) => f.code === "missing_required_directory");
  assert.ok(found, JSON.stringify(result.findings, null, 2));
  assert.equal(found.severity, "warning");
  assert.equal(found.location, "profile/");
  assert.match(found.route, /labora workspace init/);
});

test("legacy evidence/ is reported as the old name for sources/", () => {
  const result = lintPersonaLayout(persona(["profile", "evidence/notes"], completeProfileFiles()));
  const found = result.findings.find((f) => f.code === "legacy_sources_directory");
  assert.ok(found, JSON.stringify(codes(result)));
  assert.equal(found.location, `${LEGACY_SOURCES_DIR}/`);
  assert.match(found.route, /labora workspace migrate/);
});

test("retired generated profile state is reported, never treated as authored truth", () => {
  const files = { ...completeProfileFiles(), "profile/generated/claims.json": "{}\n" };
  const result = lintPersonaLayout(persona(["profile"], files));
  const found = result.findings.find((f) => f.code === "retired_generated_directory");
  assert.ok(found, JSON.stringify(codes(result)));
  assert.equal(found.severity, "info");
  assert.match(found.message, /no longer read/);
  assert.match(found.route, /Delete it when you are comfortable|leave it/);
});

test("every retired generated directory is part of the public migration contract", () => {
  assert.deepEqual(RETIRED_GENERATED_DIRS, ["profile/generated", ".labora/state/profile"]);
});

test("profile files are expected by name and absence is a finding with a route", () => {
  const result = lintPersonaLayout(persona(["profile"], { "profile/contact.md": "x\n" }));
  const absent = result.findings.filter((f) => f.code === "profile_file_absent");
  assert.deepEqual(
    absent.map((f) => f.location).sort(),
    AUTHORED_PROFILE_FILES.filter((name) => name !== "contact.md").map((name) => `profile/${name}`).sort(),
  );
  for (const f of absent) assert.match(f.route, /labora:start/);
});

test("an undeclared top-level directory is reported so the operator knows no stage reads it", () => {
  const result = lintPersonaLayout(persona(["profile", "notes"], completeProfileFiles()));
  const found = result.findings.find((f) => f.code === "undeclared_directory");
  assert.ok(found);
  assert.equal(found.severity, "info");
  assert.match(found.route, /sources/);
});

test("dot-directories are ignored, so tooling state is never mistaken for persona data", () => {
  const result = lintPersonaLayout(persona(["profile", ".labora/state", ".git"], completeProfileFiles()));
  assert.equal(codes(result).filter((c) => c === "undeclared_directory").length, 0);
});

test("application slugs are advisory kebab-case findings", () => {
  const result = lintPersonaLayout(persona(["profile", "applications/Bad_Name"], completeProfileFiles()));
  const found = result.findings.find((f) => f.code === "application_slug_not_kebab_case");
  assert.ok(found);
  assert.equal(found.severity, "info");
  assert.match(found.route, /Rename it if you like/);
});

test("every finding carries a route, because a gap without a next step is unfinished work", () => {
  const result = lintPersonaLayout(persona(["evidence", "notes"], { "profile/generated/claims.json": "{}\n" }));
  assert.ok(result.findings.length >= 3);
  for (const f of result.findings) {
    assert.ok(f.route && f.route.trim().length > 0, `${f.code} has no route`);
    assert.ok(["warning", "info"].includes(f.severity), `${f.code} has severity ${f.severity}`);
  }
});

test("every declared persona directory states who owns it", () => {
  assert.deepEqual(Object.values(OWNERSHIP), ["authored", "produced", "captured"]);
  for (const entry of PERSONA_DIRECTORIES) {
    assert.ok(Object.values(OWNERSHIP).includes(entry.ownership), entry.name);
    assert.equal(typeof entry.optional, "boolean", entry.name);
    assert.ok(entry.purpose.length > 0, entry.name);
  }
});

test("the current directory contract names profile, sources, applications, and job-search", () => {
  assert.deepEqual(PERSONA_DIRECTORIES.map((entry) => entry.name), [
    "profile", "sources", "applications", "job-search",
  ]);
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

test("the committed example persona satisfies its own current contract", () => {
  const example = path.join(process.cwd(), "data", "personas", "example");
  if (!fs.existsSync(example)) return;
  const result = lintPersonaLayout(example);
  assert.deepEqual(result.findings, [], JSON.stringify(result.findings, null, 2));
});
