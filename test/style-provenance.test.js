import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { pluginRoot } from "../src/lib/paths.js";
import { recordStage, stageStatus } from "../src/lib/run-manifest.js";
import { readDocxStyleProfileId } from "../src/utils/docx-parts.js";

const labora = path.join(pluginRoot, "bin", "labora");

// Synthetic persona and contact throughout. A public repository carries no real
// person's details, and a style profile stores no contact values at all.
const RESUME = {
  target_role: "Platform Engineer",
  ats_title: "Platform Engineer",
  contact: { name: "", email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" },
  summary: "Platform engineer who measures the render path before changing it.",
  skills_primary: ["React", "TypeScript"],
  skills_secondary: [],
  experience: [
    {
      id: "example-role",
      company: "Example Systems",
      role: "Platform Engineer",
      period: "2021 - Present",
      bullets: [
        "Cut cold start latency by moving the render boundary to the edge",
        "Led a shared component library used by four teams",
      ],
    },
  ],
  education: [
    {
      school: "Example University",
      degree: "BSc Computer Science",
      location: "Seattle, WA",
      startDate: "2012",
      endDate: "2016",
    },
  ],
};

const CONTACT_MD = [
  "# Contact",
  "",
  "- Name: Jane Example",
  "- Location: Seattle, WA",
  "- Email: jane@example.test",
  "- Phone: +1 555-0100",
  "- LinkedIn: linkedin.com/in/jane-example",
  "- GitHub: github.com/jane-example",
  "- Portfolio: jane.example",
  "",
].join("\n");

const JOB_MD = [
  "# Platform Engineer",
  "",
  "## Requirements",
  "- React",
  "- TypeScript",
  "",
].join("\n");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-style-provenance-"));
  const persona = path.join(root, "data", "personas", "example");
  const profile = path.join(persona, "profile");
  const generated = path.join(profile, "generated");
  const app = path.join(persona, "applications", "job");
  fs.mkdirSync(path.join(app, "validations"), { recursive: true });
  fs.mkdirSync(generated, { recursive: true });

  for (const [file, content] of Object.entries({
    [path.join(profile, "career.md")]: "career",
    [path.join(profile, "contact.md")]: CONTACT_MD,
    [path.join(profile, "background.md")]: "background",
    [path.join(generated, "identity.json")]: "{}",
    [path.join(generated, "claims.json")]: "{}",
    [path.join(generated, "accomplishments.json")]: "{}",
    [path.join(app, "job.md")]: JOB_MD,
    [path.join(app, "job-spec.json")]: "{}",
    [path.join(app, "application-strategy.json")]: "{}",
    [path.join(app, "resume.json")]: JSON.stringify(RESUME, null, 2),
    [path.join(app, "ats-results.json")]: "{}",
    [path.join(app, "validations", "claims.json")]: "{}",
    [path.join(app, "validations", "strategy.json")]: "{}",
  })) fs.writeFileSync(file, content);

  return { root, app, profile };
}

function run(args, cwd) {
  return spawnSync(process.execPath, [labora, ...args], { cwd, encoding: "utf8" });
}

// The format stage is the only place a style is chosen, so the chosen ID has to
// survive into everything downstream: the file, its validation record and run
// state. Otherwise a later stage judges an artifact whose visual contract it
// cannot name.
for (const styleId of ["precision-minimal", "editorial-technical"]) {
  test(`${styleId} is recorded in the artifact, its validation and run state`, async () => {
    const { app, profile } = fixture();
    const contact = path.join(profile, "contact.md");
    const job = path.join(app, "job.md");
    const resume = path.join(app, "resume.json");
    const docx = path.join(app, `final-resume-style-${styleId}.docx`);
    const markdown = path.join(app, `final-resume-style-${styleId}.md`);
    const pdf = path.join(app, `final-resume-style-${styleId}.pdf`);

    const format = run(
      ["format-docx", resume, docx, "--contact", contact, "--job", job, "--style", styleId],
      app
    );
    assert.equal(format.status, 0, format.stderr);
    assert.equal(readDocxStyleProfileId({ path: docx }), styleId);

    const markdownRun = run(
      ["format-markdown", resume, markdown, "--contact", contact, "--job", job, "--style", styleId],
      app
    );
    assert.equal(markdownRun.status, 0, markdownRun.stderr);

    const validation = path.join(app, "validations", "artifact.json");
    const validate = run(
      [
        "validate-artifact", resume, docx,
        "--contact", contact, "--job", job, "--output", validation,
      ],
      app
    );
    assert.equal(validate.status, 0, validate.stderr);
    const record = JSON.parse(fs.readFileSync(validation, "utf8"));
    assert.equal(record.styleProfile.id, styleId);
    // Read from the file itself, not from a flag somebody could get wrong.
    assert.equal(record.styleProfile.source, "artifact");

    fs.writeFileSync(pdf, "pdf-placeholder");
    for (const stage of [
      "persona", "job_analysis", "application_strategy", "tailor", "format", "validate_artifact",
    ]) {
      recordStage({ applicationDir: app, stage, style: styleId });
    }
    const runState = JSON.parse(fs.readFileSync(path.join(app, "run.json"), "utf8"));
    assert.equal(runState.style, styleId);
    assert.equal(runState.styleProfile.id, styleId);
    assert.ok(runState.styleProfile.displayName);
    assert.ok(runState.stages.format.fingerprint);

    const status = stageStatus({ applicationDir: app, style: styleId });
    assert.equal(status.style, styleId);
    assert.equal(status.styleProfile.id, styleId);
    assert.equal(status.stages.format.fresh, true);

    // Re-rendering under a different profile leaves the first run's artifacts
    // alone, so the recorded ID always names the file it describes.
    const other = styleId === "precision-minimal" ? "editorial-technical" : "precision-minimal";
    assert.equal(stageStatus({ applicationDir: app, style: other }).stages.format.fresh, false);
  });
}

test("a style nobody defined stops the run instead of choosing one", () => {
  const { app, profile } = fixture();
  const contact = path.join(profile, "contact.md");
  const job = path.join(app, "job.md");
  const resume = path.join(app, "resume.json");

  const format = run(
    ["format-docx", resume, path.join(app, "out.docx"),
      "--contact", contact, "--job", job, "--style", "2"],
    app
  );
  assert.equal(format.status, 1);
  assert.match(format.stderr, /Unknown resume style "2"/);
  assert.match(format.stderr, /editorial-technical, precision-minimal/);
  assert.equal(fs.existsSync(path.join(app, "out.docx")), false);

  assert.throws(
    () => recordStage({ applicationDir: app, stage: "persona", style: "2" }),
    /Unknown resume style "2"/
  );
});
