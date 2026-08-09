import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  UNKNOWN_MODEL,
  configuredModelLabel,
  defaultSettingsPath,
  effectiveModel,
  judgeModelReport,
  readCopilotSettings,
} from "../src/lib/copilot-settings.js";
import { evaluateQualityGate } from "../src/lib/quality-gate.js";
import { expectedJudgeMetadata } from "../src/lib/judge-input.js";
import { ZReleaseOutput } from "../src/schemas/release-output.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_APPLICATION = path.join(
  repoRoot, "data", "personas", "example", "applications", "acme-senior-fe-mar-25"
);
const FIXTURE_ARTIFACT = path.join(FIXTURE_APPLICATION, "final-resume-style-1.docx");

function withSettings(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labora-settings-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
  return file;
}

test("COPILOT_HOME relocates the settings file", () => {
  assert.equal(
    defaultSettingsPath({ COPILOT_HOME: "/tmp/elsewhere" }, "/Users/ignored"),
    path.join("/tmp/elsewhere", ".copilot", "settings.json")
  );
  assert.equal(
    defaultSettingsPath({}, "/Users/someone"),
    path.join("/Users/someone", ".copilot", "settings.json")
  );
});

test("a per-agent model overrides the global default", () => {
  const settings = {
    model: "tailor-model",
    subagents: { agents: { "judge-hr": { model: "other-model" } } },
  };
  assert.deepEqual(effectiveModel(settings, "judge-hr"), {
    model: "other-model",
    source: "subagents.agents.judge-hr.model",
  });
  assert.deepEqual(effectiveModel(settings, "judge-ats"), {
    model: "tailor-model",
    source: "model",
  });
});

test("no configured model anywhere is an answer, not a failure", () => {
  assert.deepEqual(effectiveModel({}, "judge-ats"), {
    model: null,
    source: "runtime default",
  });
});

test("every judge sharing the tailor's model reports NOT diverse", () => {
  const report = judgeModelReport({
    settingsPath: withSettings({ model: "claude-opus-5" }),
  });
  assert.equal(report.status, "ok");
  assert.equal(report.diverse, false);
  assert.ok(report.judges.every((judge) => judge.differsFromTailor === false));
});

test("one judge on another model reports diverse", () => {
  const report = judgeModelReport({
    settingsPath: withSettings({
      model: "claude-opus-5",
      subagents: { agents: { "judge-engineer": { model: "gpt-5.4" } } },
    }),
  });
  assert.equal(report.diverse, true);
  assert.equal(report.judges.filter((judge) => judge.differsFromTailor).length, 1);
});

// A missing file inside an existing config directory is knowable: nothing is
// configured, so every agent inherits the same default.
test("a missing settings file in a real config dir is not diverse", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labora-cfg-"));
  const report = judgeModelReport({ settingsPath: path.join(dir, "settings.json") });
  assert.equal(report.status, "missing");
  assert.equal(report.diverse, false);
});

// But an absent config directory means this is probably not the runtime whose
// configuration we can read at all (labora also runs under Claude Code). That
// is unknown, and must not be reported as "nothing is configured".
test("an absent config directory is unsupported and unknown, not not-diverse", () => {
  const report = judgeModelReport({
    settingsPath: path.join(os.tmpdir(), "labora-no-such-dir-xyz", "settings.json"),
  });
  assert.equal(report.status, "unsupported");
  assert.equal(report.diverse, null);
  assert.ok(report.error);
});

// The distinction that matters most: a check that could not run must never
// look like a check that ran and passed, nor like one that ran and failed.
test("an unreadable settings file reports unknown, not a verdict", () => {
  const report = judgeModelReport({ settingsPath: withSettings("{ not json") });
  assert.equal(report.status, "error");
  assert.equal(report.diverse, null);
  assert.ok(report.error);
});

test("a settings file that is not an object is unknown", () => {
  const report = judgeModelReport({ settingsPath: withSettings("[1,2,3]") });
  assert.equal(report.status, "error");
  assert.equal(report.diverse, null);
});

test("the report never carries the operator's raw settings", () => {
  const report = judgeModelReport({
    settingsPath: withSettings({ model: "m", githubToken: "SECRET-VALUE" }),
  });
  assert.ok(!JSON.stringify(report).includes("SECRET-VALUE"));
});

test("the report carries its own caveat so consumers cannot drop it", () => {
  const report = judgeModelReport({ settingsPath: withSettings({ model: "m" }) });
  assert.match(report.caveat, /not observation/i);
});

test("an unreadable configuration labels the model unknown rather than naming one", () => {
  const report = judgeModelReport({ settingsPath: withSettings("{ not json") });
  assert.equal(configuredModelLabel(report, "judge-ats"), UNKNOWN_MODEL);
});

// The label is calibration's grouping key, so it must be a model identity and
// not a description of how the model was reached. The same model inherited and
// explicitly pinned has to produce one bucket, or drift analysis invents a
// model change that never happened.
test("the same model reached two ways produces one grouping key", () => {
  const inherited = judgeModelReport({ settingsPath: withSettings({ model: "claude-opus-5" }) });
  const pinned = judgeModelReport({
    settingsPath: withSettings({
      model: "claude-opus-5",
      subagents: { agents: { "judge-ats": { model: "claude-opus-5" } } },
    }),
  });
  assert.equal(
    configuredModelLabel(inherited, "judge-ats"),
    configuredModelLabel(pinned, "judge-ats")
  );
  assert.equal(configuredModelLabel(pinned, "judge-ats"), "claude-opus-5");
});

test("an unconfigured runtime default gets a stable key, not a null", () => {
  const report = judgeModelReport({ settingsPath: withSettings({}) });
  assert.equal(configuredModelLabel(report, "judge-hr"), "runtime-default");
});

test("a deliberately configured model is labelled bare", () => {
  const report = judgeModelReport({
    settingsPath: withSettings({
      model: "claude-opus-5",
      subagents: { agents: { "judge-hr": { model: "gpt-5.4" } } },
    }),
  });
  assert.equal(configuredModelLabel(report, "judge-hr"), "gpt-5.4");
});

function judgeFixture(overrides = {}) {
  const metadata = {
    rubricVersion: "1.0",
    model: "configured-model",
    evaluatedArtifactHash: "a".repeat(64),
    promptHash: "b".repeat(64),
    inputHash: "c".repeat(64),
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
  return { metadata, score: 95, verdict: "pass", screeningRisk: "low", reasoning: "" };
}

function expectedFor(model = "configured-model") {
  return {
    model,
    evaluatedArtifactHash: "a".repeat(64),
    promptHash: "b".repeat(64),
    inputHash: "c".repeat(64),
  };
}

// The whole point of supplying `model` from tooling is that it becomes
// checkable. If the gate ignores it, a judge can still write fiction.
test("a judge that rewrites the supplied model is caught as stale", () => {
  const result = evaluateQualityGate({
    atsJudge: judgeFixture({ model: "Claude 3.5 Sonnet" }),
    expectedJudgeMetadata: { ats: expectedFor() },
    artifactHash: "a".repeat(64),
    artifactPath: "resume.docx",
    artifactType: "docx",
  });
  assert.ok(
    result.hardBlockers.some((blocker) => /ATS judge metadata is stale.*model/.test(blocker)),
    `expected a model mismatch blocker, got: ${JSON.stringify(result.hardBlockers)}`
  );
  assert.equal(result.gates.atsJudge, false);
});

test("a judge that copies the supplied model verbatim raises no model blocker", () => {
  const result = evaluateQualityGate({
    atsJudge: judgeFixture(),
    expectedJudgeMetadata: { ats: expectedFor() },
    artifactHash: "a".repeat(64),
    artifactPath: "resume.docx",
    artifactType: "docx",
  });
  assert.ok(!result.hardBlockers.some((blocker) => /model/.test(blocker)));
});

test("the release record carries the model configuration as evidence", () => {
  const report = judgeModelReport({ settingsPath: withSettings({ model: "claude-opus-5" }) });
  const result = evaluateQualityGate({
    artifactHash: "a".repeat(64),
    artifactPath: "resume.docx",
    artifactType: "docx",
    judgeModels: report,
  });
  assert.equal(result.judgeModels.diverse, false);
  assert.equal(result.judgeModels.judges.length, 3);
});

// Recorded, not gated: a signal that fires on every default install would be
// ignored, and model choice is an operator property rather than a defect in
// this application.
test("model non-diversity is recorded without changing release state", () => {
  const notDiverse = judgeModelReport({ settingsPath: withSettings({ model: "claude-opus-5" }) });
  const diverse = judgeModelReport({
    settingsPath: withSettings({
      model: "claude-opus-5",
      subagents: { agents: { "judge-hr": { model: "gpt-5.4" } } },
    }),
  });
  const base = {
    artifactHash: "a".repeat(64),
    artifactPath: "resume.docx",
    artifactType: "docx",
  };
  const a = evaluateQualityGate({ ...base, judgeModels: notDiverse });
  const b = evaluateQualityGate({ ...base, judgeModels: diverse });
  assert.equal(a.state, b.state);
  assert.deepEqual(a.reviewReasons, b.reviewReasons);
});

test("readCopilotSettings distinguishes all four states", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labora-cfg-"));
  assert.equal(readCopilotSettings(path.join(dir, "settings.json")).status, "missing");
  assert.equal(readCopilotSettings(path.join(os.tmpdir(), "no-dir-xyz", "settings.json")).status, "unsupported");
  assert.equal(readCopilotSettings(withSettings("{oops")).status, "error");
  assert.equal(readCopilotSettings(withSettings({ model: "m" })).status, "ok");
});

// An unreadable settings file says nothing about the model that judged. Letting
// it invalidate three correct verdicts would turn a check that could not run
// into a check that failed.
test("an unknown model on either side does not invalidate a verdict", () => {
  const base = {
    artifactHash: "a".repeat(64),
    artifactPath: "resume.docx",
    artifactType: "docx",
  };
  const wentUnknown = evaluateQualityGate({
    ...base,
    atsJudge: judgeFixture({ model: "claude-opus-5" }),
    expectedJudgeMetadata: { ats: expectedFor(UNKNOWN_MODEL) },
  });
  assert.ok(!wentUnknown.hardBlockers.some((b) => /model/.test(b)), JSON.stringify(wentUnknown.hardBlockers));
  assert.equal(wentUnknown.gates.atsJudge, true);

  const wasUnknown = evaluateQualityGate({
    ...base,
    atsJudge: judgeFixture({ model: UNKNOWN_MODEL }),
    expectedJudgeMetadata: { ats: expectedFor("claude-opus-5") },
  });
  assert.ok(!wasUnknown.hardBlockers.some((b) => /model/.test(b)));
});

// Every per-agent field must stay null when nothing was read. Reporting
// differsFromTailor: false from an empty stand-in states a definite fact about
// a file nobody managed to open.
test("an unreadable configuration asserts nothing per agent", () => {
  for (const settingsPath of [withSettings("{ not json"), path.join(os.tmpdir(), "no-dir-xyz", "settings.json")]) {
    const report = judgeModelReport({ settingsPath });
    assert.equal(report.diverse, null);
    assert.equal(report.tailor.model, null);
    assert.equal(report.tailor.source, null);
    for (const judge of report.judges) {
      assert.equal(judge.model, null);
      assert.equal(judge.source, null);
      assert.equal(judge.differsFromTailor, null, "differsFromTailor must be unknown, not false");
    }
  }
});

test("malformed subagents configuration falls through instead of throwing", () => {
  const cases = [
    { subagents: null },
    { subagents: { agents: null } },
    { subagents: { agents: [] } },
    { subagents: { agents: { "judge-ats": {} } } },
    { subagents: { agents: { "judge-ats": "gpt-5.4" } } },
    { subagents: { agents: { "judge-ats": { model: "" } } } },
    { subagents: { agents: { "judge-ats": { model: 123 } } } },
  ];
  for (const settings of cases) {
    assert.deepEqual(
      effectiveModel({ model: "base", ...settings }, "judge-ats"),
      { model: "base", source: "model" },
      JSON.stringify(settings)
    );
  }
  assert.equal(effectiveModel({ subagents: { agents: { "judge-ats": { model: "  gpt-5.4  " } } } }, "judge-ats").model, "gpt-5.4");
});

test("inherited prototype keys are not mistaken for configuration", () => {
  for (const agent of ["constructor", "toString", "__proto__"]) {
    assert.equal(effectiveModel({ subagents: { agents: {} } }, agent).model, null);
  }
});

// The point of supplying the model from tooling is that it reaches the judge's
// metadata. If it never lands there, nothing downstream is grounded.
test("expectedJudgeMetadata records the configured model", async () => {
  const settingsPath = withSettings({
    model: "claude-opus-5",
    subagents: { agents: { "judge-ats": { model: "gpt-5.4" } } },
  });
  const { metadata } = await expectedJudgeMetadata({
    applicationDir: FIXTURE_APPLICATION,
    artifactPath: FIXTURE_ARTIFACT,
    judge: "ats",
    settingsPath,
  });
  assert.equal(metadata.model, "gpt-5.4");
});

// A release record written before this field existed must still parse.
test("a real report round-trips through the release schema in every state", () => {
  const base = {
    schemaVersion: "1.0",
    state: "send_ready",
    generatedAt: new Date().toISOString(),
    artifact: { path: "r.docx", type: "docx", hash: "a".repeat(64) },
    hardBlockers: [],
    reviewReasons: [],
    gates: {
      strategy: true, claims: true, artifact: true, requirements: true,
      coreRequirements: true, atsJudge: true, engineerJudge: true, hrJudge: true,
    },
  };
  assert.equal(ZReleaseOutput.parse(base).judgeModels, null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labora-cfg-"));
  const paths = [
    withSettings({ model: "m" }),
    path.join(dir, "settings.json"),
    withSettings("{bad"),
    path.join(os.tmpdir(), "no-dir-xyz", "settings.json"),
  ];
  for (const settingsPath of paths) {
    const judgeModels = judgeModelReport({ settingsPath });
    assert.deepEqual(ZReleaseOutput.parse({ ...base, judgeModels }).judgeModels, judgeModels);
  }
});
