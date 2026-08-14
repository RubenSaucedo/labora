import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { recordStage, stageStatus, stageDefinitions } from "../src/lib/run-manifest.js";

function writeValidEvidence(persona, rawContent = "pdf-v1", layout = []) {
  const base = path.join(persona, "evidence", "performance-reviews");
  const outputBase = path.join(base, ...layout);
  const rawPath = path.join(outputBase, "raw", "review.pdf");
  const extractedPath = path.join(outputBase, "extracted", "review.md");
  const metadataPath = path.join(outputBase, "extracted", "review.json");
  const cleanedPath = path.join(outputBase, "text", "review.md");
  const validationPath = path.join(outputBase, "validations", "review.json");
  for (const file of [rawPath, extractedPath, metadataPath, cleanedPath, validationPath]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const extracted = "Extracted evidence\n";
  const cleaned = "Extracted evidence\n";
  fs.writeFileSync(rawPath, rawContent);
  fs.writeFileSync(extractedPath, extracted);
  fs.writeFileSync(cleanedPath, cleaned);
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const sourceHash = hash(Buffer.from(rawContent));
  const extractedHash = hash(Buffer.from(extracted));
  const cleanedHash = hash(Buffer.from(cleaned));
  fs.writeFileSync(metadataPath, JSON.stringify({ sourceHash, extractedHash }));
  fs.writeFileSync(validationPath, JSON.stringify({
    valid: true,
    bindings: { sourceHash, extractedHash, cleanedHash },
  }));
  return { rawPath, validationPath };
}

test("invalidates a recorded stage when an upstream input changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-state-"));
  const app = path.join(root, "data", "personas", "example", "applications", "job");
  const profile = path.join(root, "data", "personas", "example", "profile");
  const generated = path.join(profile, "generated");
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(generated, { recursive: true });
  fs.writeFileSync(path.join(profile, "career.md"), "Career v1");
  fs.writeFileSync(path.join(profile, "contact.md"), "Name: Jane");
  fs.writeFileSync(path.join(profile, "background.md"), "Background v1");
  fs.writeFileSync(path.join(generated, "identity.json"), "{}");
  fs.writeFileSync(path.join(generated, "claims.json"), "{}");
  fs.writeFileSync(path.join(generated, "accomplishments.json"), "{}");

  recordStage({ applicationDir: app, stage: "persona", style: 1 });
  assert.equal(stageStatus({ applicationDir: app, style: 1 }).stages.persona.fresh, true);

  fs.writeFileSync(path.join(profile, "career.md"), "Career v2");
  assert.equal(stageStatus({ applicationDir: app, style: 1 }).stages.persona.fresh, false);
});

test("invalidates persona when raw evidence changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-evidence-state-"));
  const app = path.join(root, "data", "personas", "example", "applications", "job");
  const persona = path.join(root, "data", "personas", "example");
  const profile = path.join(persona, "profile");
  const generated = path.join(profile, "generated");
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(generated, { recursive: true });
  fs.writeFileSync(path.join(profile, "career.md"), "Career");
  fs.writeFileSync(path.join(profile, "contact.md"), "Name: Jane");
  fs.writeFileSync(path.join(profile, "background.md"), "Background");
  fs.writeFileSync(path.join(generated, "identity.json"), "{}");
  fs.writeFileSync(path.join(generated, "claims.json"), "{}");
  fs.writeFileSync(path.join(generated, "accomplishments.json"), "{}");
  const { rawPath } = writeValidEvidence(persona);

  recordStage({ applicationDir: app, stage: "persona", style: 1 });
  fs.writeFileSync(rawPath, "pdf-v2");

  assert.equal(
    stageStatus({ applicationDir: app, style: 1 }).stages.persona.fresh,
    false
  );
});

test("accepts dated evidence layouts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-dated-evidence-"));
  const persona = path.join(root, "data", "personas", "example");
  const app = path.join(persona, "applications", "job");
  const profile = path.join(persona, "profile");
  const generated = path.join(profile, "generated");
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(generated, { recursive: true });
  fs.writeFileSync(path.join(profile, "career.md"), "Career");
  fs.writeFileSync(path.join(profile, "contact.md"), "Name: Jane");
  fs.writeFileSync(path.join(profile, "background.md"), "Background");
  fs.writeFileSync(path.join(generated, "identity.json"), "{}");
  fs.writeFileSync(path.join(generated, "claims.json"), "{}");
  fs.writeFileSync(path.join(generated, "accomplishments.json"), "{}");
  writeValidEvidence(persona, "pdf-v1", ["2026"]);

  assert.doesNotThrow(() =>
    recordStage({ applicationDir: app, stage: "persona", style: 1 })
  );
});

test("persona cannot be recorded with failed evidence cleaning", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-evidence-invalid-"));
  const persona = path.join(root, "data", "personas", "example");
  const app = path.join(persona, "applications", "job");
  const profile = path.join(persona, "profile");
  const generated = path.join(profile, "generated");
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(generated, { recursive: true });
  fs.writeFileSync(path.join(profile, "career.md"), "Career");
  fs.writeFileSync(path.join(profile, "contact.md"), "Name: Jane");
  fs.writeFileSync(path.join(profile, "background.md"), "Background");
  fs.writeFileSync(path.join(generated, "identity.json"), "{}");
  fs.writeFileSync(path.join(generated, "claims.json"), "{}");
  fs.writeFileSync(path.join(generated, "accomplishments.json"), "{}");
  const { validationPath } = writeValidEvidence(persona);
  const validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));
  validation.valid = false;
  fs.writeFileSync(validationPath, JSON.stringify(validation));

  assert.throws(
    () => recordStage({ applicationDir: app, stage: "persona", style: 1 }),
    /assurance checks failed/
  );
});

test("propagates artifact staleness into judges and the quality gate", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-state-chain-"));
  const app = path.join(root, "data", "personas", "example", "applications", "job");
  const profile = path.join(root, "data", "personas", "example", "profile");
  const generated = path.join(profile, "generated");
  fs.mkdirSync(path.join(app, "validations"), { recursive: true });
  fs.mkdirSync(path.join(app, "judges"), { recursive: true });
  fs.mkdirSync(generated, { recursive: true });

  for (const [file, content] of Object.entries({
    [path.join(profile, "career.md")]: "career",
    [path.join(profile, "contact.md")]: "Name: Jane",
    [path.join(profile, "background.md")]: "background",
    [path.join(generated, "identity.json")]: "{}",
    [path.join(generated, "claims.json")]: "{}",
    [path.join(generated, "accomplishments.json")]: "{}",
    [path.join(app, "job.md")]: "job",
    [path.join(app, "job-spec.json")]: "{}",
    [path.join(app, "application-strategy.json")]: "{}",
    [path.join(app, "resume.json")]: "{}",
    [path.join(app, "ats-results.json")]: "{}",
    [path.join(app, "final-resume-style-1.docx")]: "docx-v1",
    [path.join(app, "final-resume-style-1.md")]: "markdown-v1",
    [path.join(app, "final-resume-style-1.pdf")]: "pdf-v1",
    [path.join(app, "validations", "claims.json")]: "{}",
    [path.join(app, "validations", "strategy.json")]: "{}",
    [path.join(app, "validations", "artifact.json")]: "{}",
    [path.join(app, "judges", "ats.json")]: "{}",
    [path.join(app, "judges", "engineer.json")]: "{}",
    [path.join(app, "judges", "hr.json")]: "{}",
    [path.join(app, "release.json")]: "{}",
  })) fs.writeFileSync(file, content);

  for (const stage of [
    "persona", "job_analysis", "application_strategy", "tailor", "format", "validate_claims",
    "validate_artifact", "judge_ats", "judge_engineer", "judge_hr", "quality_gate",
  ]) {
    recordStage({ applicationDir: app, stage, style: 1 });
  }

  fs.writeFileSync(path.join(app, "final-resume-style-1.md"), "manual edit");
  let status = stageStatus({ applicationDir: app, style: 1 });
  assert.equal(status.stages.format.fresh, false);
  assert.equal(status.stages.validate_artifact.fresh, false);
  assert.equal(status.stages.quality_gate.fresh, false);

  fs.writeFileSync(path.join(app, "final-resume-style-1.md"), "markdown-v1");
  fs.unlinkSync(path.join(app, "final-resume-style-1.pdf"));
  status = stageStatus({ applicationDir: app, style: 1 });
  assert.equal(status.stages.format.fresh, false);
  assert.equal(status.stages.judge_ats.fresh, false);
  assert.equal(status.stages.quality_gate.fresh, false);
});

// --- profile ownership boundary --------------------------------------------
// Human-authored sources live at the profile root and are only ever read.
// Everything the pipeline writes for a persona belongs to resume-persona and
// lives under profile/generated/, so the boundary is enforced by the stage
// graph rather than by convention alone.

test("every persona-stage output lives under profile/generated/", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-ownership-"));
  const app = path.join(root, "data", "personas", "example", "applications", "job");
  const profile = path.join(root, "data", "personas", "example", "profile");
  const generated = path.join(profile, "generated");
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(generated, { recursive: true });

  const definitions = stageDefinitions({
    personaRoot: path.join(root, "data", "personas", "example"),
    applicationDir: app,
    style: 1,
  });

  assert.ok(definitions.persona.outputs.length > 0);
  for (const output of definitions.persona.outputs) {
    assert.equal(
      path.dirname(output),
      generated,
      `persona output ${path.basename(output)} must be written under profile/generated/`
    );
  }
});

test("no stage writes to a human-authored profile source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-ownership-sources-"));
  const persona = path.join(root, "data", "personas", "example");
  const app = path.join(persona, "applications", "job");
  const profile = path.join(persona, "profile");
  const definitions = stageDefinitions({
    personaRoot: persona,
    applicationDir: app,
    style: 1,
  });

  const humanSources = new Set([
    path.join(profile, "contact.md"),
    path.join(profile, "background.md"),
    path.join(profile, "career.md"),
    path.join(profile, "search-preferences.json"),
  ]);

  for (const [stage, definition] of Object.entries(definitions)) {
    for (const output of definition.outputs || []) {
      assert.equal(
        humanSources.has(output),
        false,
        `stage ${stage} must not write the human-authored source ${path.basename(output)}`
      );
    }
  }
});

test("tailoring freshness includes the specialist prompt and writing reference", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-writer-state-"));
  const persona = path.join(root, "data", "personas", "example");
  const app = path.join(persona, "applications", "job");
  const definitions = stageDefinitions({
    personaRoot: persona,
    applicationDir: app,
    style: 1,
  });
  const dependencies = definitions.tailor.dependencies.map((dependency) =>
    dependency.split(path.sep).join("/")
  );

  assert.ok(
    dependencies.some((dependency) => dependency.endsWith("/agents/resume-writer-expert.agent.md"))
  );
  assert.ok(
    dependencies.some((dependency) =>
      dependency.endsWith("/skills/resume-tailor/references/senior-swe-writing.md")
    )
  );
});
