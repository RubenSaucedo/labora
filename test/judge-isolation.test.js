import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordStage, stageStatus } from "../src/lib/run-manifest.js";
import { ZAtsJudgeOutput } from "../src/schemas/judge-output.js";

/**
 * Structural judge independence: a judge's declared inputs must exclude the
 * generator's provenance and rationale, and the output schema must not let a
 * judge smuggle provenance back in. These encode the isolation guarantee at the
 * code level, so a refactor that quietly wires provenance into a judge fails CI.
 */

function buildApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "judge-isolation-"));
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
  return { root, app };
}

test("judges do not depend on provenance sources (resume, claims, core, validations)", () => {
  const { root, app } = buildApp();
  // Rewrite every provenance/generator-rationale carrier a judge must never read.
  fs.writeFileSync(path.join(app, "resume.json"), '{"tampered":true}');
  fs.writeFileSync(path.join(root, "data", "personas", "example", "profile", "generated", "claims.json"), '{"tampered":true}');
  fs.writeFileSync(path.join(root, "data", "personas", "example", "profile", "generated", "identity.json"), '{"tampered":true}');
  fs.writeFileSync(path.join(app, "validations", "claims.json"), '{"tampered":true}');

  const status = stageStatus({ applicationDir: app, style: 1 }).stages;

  // Control: the tailor stage DID consume resume.json, so it must now be stale.
  assert.equal(status.tailor.selfFresh, false, "control: tampering with provenance invalidates the generator stage");

  // Guarantee: each judge's own input set excludes provenance, so it stays fresh.
  for (const judge of ["judge_ats", "judge_engineer", "judge_hr"]) {
    assert.equal(status[judge].selfFresh, true, `${judge} must not depend on provenance`);
  }
});

test("a judge stage does go stale when the rendered artifact changes", () => {
  const { root, app } = buildApp();
  fs.writeFileSync(path.join(app, "final-resume-style-1.docx"), "docx-v2");
  const status = stageStatus({ applicationDir: app, style: 1 }).stages;
  for (const judge of ["judge_ats", "judge_engineer", "judge_hr"]) {
    assert.equal(status[judge].selfFresh, false, `${judge} must re-run when the delivery artifact changes`);
  }
});

test("the judge output schema rejects smuggled provenance fields", () => {
  const valid = {
    metadata: {
      rubricVersion: "1.0",
      model: "some-model",
      evaluatedArtifactHash: "a".repeat(64),
      promptHash: "b".repeat(64),
      inputHash: "c".repeat(64),
      evaluatedAt: "2026-07-15T00:00:00.000Z",
    },
    score: 80,
    verdict: "pass",
    screeningRisk: "low",
    reasoning: "ok",
    details: { matchedSignals: [], missingSignals: [], recommendations: [] },
  };
  assert.equal(ZAtsJudgeOutput.safeParse(valid).success, true);
  const leaky = { ...valid, provenance: { bullets: [] }, generatorRationale: "why I tailored it" };
  assert.equal(ZAtsJudgeOutput.safeParse(leaky).success, false);
});

test("the judge output schema rejects a verdict that contradicts its score", () => {
  const contradictory = {
    metadata: {
      rubricVersion: "1.0",
      model: "some-model",
      evaluatedArtifactHash: "a".repeat(64),
      promptHash: "b".repeat(64),
      inputHash: "c".repeat(64),
      evaluatedAt: "2026-07-15T00:00:00.000Z",
    },
    score: 0,
    verdict: "pass",
    screeningRisk: "low",
    reasoning: "contradictory",
    details: { matchedSignals: [], missingSignals: [], recommendations: [] },
  };
  assert.equal(ZAtsJudgeOutput.safeParse(contradictory).success, false);
});
