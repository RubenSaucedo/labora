import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { pluginRoot } from "../src/lib/paths.js";
import { requiredDependencies } from "../src/lib/tool-dependencies.js";
import {
  CAREER_ISSUE_KINDS,
  collectForbiddenTerms,
  disclosureFindings,
  fileCommand,
  normalizeDraft,
  renderCareerIssue,
  renderProvenanceTrailer,
  shellQuote,
  slugifyTitle,
} from "../src/lib/career-issue.js";

const toolPath = path.join(pluginRoot, "src", "tools", "career-issue.js");

const baseDraft = {
  kind: "legibility",
  repo: "octocat/widget",
  title: "Say what the service does in the README",
  problem: "The README lists install steps and never states what the service is for.",
  route: "Add a two-sentence opening paragraph naming the problem it solves.",
  doneWhen: "The first paragraph of README.md names the problem and the consumer.",
  draftedAt: "2026-08-10T00:00:00.000Z",
};

function workspace(fixture = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-career-issue-"));
  if (fixture.identity) {
    fs.mkdirSync(path.join(root, "profile/generated"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "profile/generated/identity.json"),
      JSON.stringify(fixture.identity)
    );
  }
  for (const [slug, spec] of Object.entries(fixture.applications || {})) {
    fs.mkdirSync(path.join(root, "applications", slug), { recursive: true });
    if (spec) {
      fs.writeFileSync(path.join(root, "applications", slug, "job-spec.json"), JSON.stringify(spec));
    }
  }
  return root;
}

test("the drafter runs where no dependency is installed", () => {
  const declared = Object.keys(
    JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).dependencies || {}
  );
  assert.deepEqual(
    requiredDependencies(toolPath, declared),
    [],
    "a gate that withholds publication must run on a machine that cannot install packages"
  );
});

test("every kind renders with its own heading", () => {
  for (const kind of CAREER_ISSUE_KINDS) {
    const body = renderCareerIssue({ ...baseDraft, kind });
    assert.match(body, /^## /m, `${kind} rendered no section`);
    assert.match(body, /## Route/);
    assert.match(body, /## Done when/);
  }
});

test("gap and growth carry a standing notice that the work is not yet done", () => {
  for (const kind of ["gap", "growth"]) {
    const body = renderCareerIssue({ ...baseDraft, kind });
    assert.match(
      body.replace(/\s+/g, " "),
      /has not been done yet/,
      `${kind} must not read as a record of completed work`
    );
  }
  for (const kind of ["polish", "legibility"]) {
    const body = renderCareerIssue({ ...baseDraft, kind });
    assert.doesNotMatch(body.replace(/\s+/g, " "), /has not been done yet/);
  }
});

test("the provenance trailer carries only allowlisted identifiers", () => {
  const draft = normalizeDraft({
    ...baseDraft,
    provenance: { claimIds: ["CLM-4"], requirementId: "REQ-2", gapStatus: "real_gap" },
  });
  const trailer = renderProvenanceTrailer(draft);
  assert.match(trailer, /kind=legibility/);
  assert.match(trailer, /claims=CLM-4/);
  assert.match(trailer, /requirement=REQ-2/);
  assert.match(trailer, /drafted=2026-08-10/);
});

test("an application slug can never enter the provenance trailer", () => {
  assert.throws(
    () => normalizeDraft({ ...baseDraft, provenance: { application: "acme-staff-engineer-jan" } }),
    /not an allowlisted field/,
    "a slug encodes the target employer and the posting title"
  );
});

test("a draft missing a bounded route or an observable condition is refused", () => {
  assert.throws(() => normalizeDraft({ ...baseDraft, route: "" }), /route is required/);
  assert.throws(() => normalizeDraft({ ...baseDraft, doneWhen: "" }), /doneWhen is required/);
  assert.throws(() => normalizeDraft({ ...baseDraft, repo: "widget" }), /owner\/repo/);
  assert.throws(() => normalizeDraft({ ...baseDraft, kind: "chore" }), /kind must be one of/);
});

test("forbidden terms are derived from the workspace, not guessed", () => {
  const root = workspace({
    identity: { contact: { name: "Alex Rivera" }, experience: [{ company: "Initech" }] },
    applications: { "globex-staff-engineer-jan-01": { company: "Globex" } },
  });
  const terms = collectForbiddenTerms(root);
  assert.ok(terms.includes("Initech"));
  assert.ok(terms.includes("Globex"));
  assert.ok(terms.includes("globex-staff-engineer-jan-01"));
  assert.ok(terms.includes("Rivera"));
  assert.ok(terms.includes("recruiter"), "job-search context is forbidden everywhere");
});

test("an empty workspace still forbids job-search context", () => {
  const terms = collectForbiddenTerms(workspace());
  assert.ok(terms.includes("hiring manager"));
  assert.ok(terms.includes("salary"));
});

test("the disclosure scan matches whole words and ignores case", () => {
  const findings = disclosureFindings("Wanted by the RECRUITER team", ["recruiter", "Initech"]);
  assert.deepEqual(findings.map((f) => f.term), ["recruiter"]);
  assert.equal(
    disclosureFindings("recruitersaurus rex", ["recruiter"]).length,
    0,
    "a substring inside a longer word is not a mention"
  );
});

test("an acknowledged term stops being a finding", () => {
  const text = "Deploy the preview to Globex Cloud.";
  assert.equal(disclosureFindings(text, ["Globex"]).length, 1);
  assert.equal(disclosureFindings(text, ["Globex"], ["globex"]).length, 0);
});

test("a title is shell-quoted so pasted text cannot become a command", () => {
  const quoted = shellQuote("it's done; rm -rf /");
  assert.equal(quoted, `'it'\\''s done; rm -rf /'`);
  const echoed = spawnSync("bash", ["-c", `printf %s ${quoted}`], { encoding: "utf8" });
  assert.equal(echoed.stdout, "it's done; rm -rf /");
});

test("slugs stay filesystem-safe and bounded", () => {
  assert.equal(slugifyTitle("Say what it does! (README)"), "say-what-it-does-readme");
  assert.equal(slugifyTitle("///"), "issue");
  assert.ok(slugifyTitle("x".repeat(200)).length <= 60);
});

test("the printed command targets the body file and never runs gh", () => {
  const draft = normalizeDraft(baseDraft);
  const command = fileCommand(draft, "/tmp/body.md");
  assert.match(command, /^gh issue create /);
  assert.match(command, /--body-file '\/tmp\/body\.md'/);
  const source = fs.readFileSync(toolPath, "utf8");
  assert.doesNotMatch(
    source,
    /spawn|exec|execSync/,
    "the tool drafts; a human files. It must not be able to file on its own."
  );
});

test("the tool withholds the filing command when a draft leaks the job search", () => {
  const root = workspace({ applications: { "globex-staff-engineer-jan-01": { company: "Globex" } } });
  const result = spawnSync(
    process.execPath,
    [
      toolPath, "draft", root,
      "--kind", "legibility",
      "--repo", "octocat/widget",
      "--title", "Explain what the service does",
      "--problem", "Needed because Globex asked about it.",
      "--route", "Add an opening paragraph.",
      "--done-when", "The README names the problem.",
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Globex/);
  assert.doesNotMatch(result.stdout, /gh issue create/);
  const drafts = fs.readdirSync(path.join(root, "career-issues"));
  assert.ok(
    drafts.some((name) => name.endsWith(".md")),
    "the workspace is private and keeps the draft; only publication is withheld"
  );
});

test("a clean draft prints the body and the exact command", () => {
  const root = workspace();
  const result = spawnSync(
    process.execPath,
    [
      toolPath, "draft", root,
      "--kind", "gap",
      "--repo", "octocat/widget",
      "--title", "Add a load test",
      "--problem", "The service has no reproducible load profile.",
      "--route", "Add a k6 script covering the read path.",
      "--done-when", "`npm run loadtest` reports p95 for the read path.",
      "--claim", "CLM-1",
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## What's missing/);
  assert.match(result.stdout, /gh issue create --repo 'octocat\/widget'/);
  assert.match(result.stdout, /claims=CLM-1/);
});

test("check re-scans a hand-edited body", () => {
  const root = workspace({ identity: { contact: { name: "Alex Rivera" } } });
  const bodyPath = path.join(root, "edited.md");
  fs.writeFileSync(bodyPath, "## What's broken\n\nRivera renamed the flag.\n");
  const dirty = spawnSync(process.execPath, [toolPath, "check", root, bodyPath], {
    encoding: "utf8",
  });
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /Rivera/);

  fs.writeFileSync(bodyPath, "## What's broken\n\nThe flag was renamed.\n");
  const clean = spawnSync(process.execPath, [toolPath, "check", root, bodyPath], {
    encoding: "utf8",
  });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /clear to publish/);
});

test("the skill states that a filed issue is not evidence", () => {
  const skill = fs.readFileSync(
    path.join(pluginRoot, "skills", "career-issue", "SKILL.md"),
    "utf8"
  ).replace(/\s+/g, " ");
  assert.match(skill, /A filed issue is a promise/);
  assert.match(skill, /No later stage may read open issues as claims/);
  assert.match(skill, /never files|it never files|drafts; a human files/i);
});
