#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { evaluateQualityGate } from "../lib/quality-gate.js";
import { ZReleaseOutput } from "../schemas/release-output.js";
import {
  ZAtsJudgeOutput,
  ZEngineerJudgeOutput,
  ZHrJudgeOutput,
} from "../schemas/judge-output.js";
import { stageStatus } from "../lib/run-manifest.js";
import { expectedJudgeMetadata } from "../lib/judge-input.js";

function readJson(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function parseJudge(filePath, schema, label, errors) {
  const raw = readJson(filePath);
  if (!raw) return null;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    errors.push(`${label} judge output failed schema validation.`);
    return null;
  }
  return parsed.data;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const applicationArg = process.argv[2];
if (!applicationArg) {
  process.stderr.write("Usage: node src/tools/quality-gate.js <application-dir> [--style N] [--artifact <resume.docx|resume.pdf>]\n");
  process.exit(1);
}

try {
  const applicationDir = path.resolve(applicationArg);
  const style = Number(flag("--style", "1"));
  const artifactPath = path.resolve(
    flag("--artifact", path.join(applicationDir, `final-resume-style-${style}.docx`))
  );
  const artifactType = path.extname(artifactPath).toLowerCase().slice(1);
  if (!["docx", "pdf"].includes(artifactType)) {
    throw new Error("Delivery artifact must be DOCX or PDF.");
  }
  const artifactHash = fs.existsSync(artifactPath) ? sha256(artifactPath) : null;
  const expectedMetadata = artifactHash
    ? Object.fromEntries(await Promise.all(["ats", "engineer", "hr"].map(async (judge) => [
      judge,
      (await expectedJudgeMetadata({
        repoRoot: process.cwd(),
        applicationDir,
        artifactPath,
        judge,
      })).metadata,
    ])))
    : {};
  const judgeValidationErrors = [];
  const atsJudge = parseJudge(
    path.join(applicationDir, "judges", "ats.json"),
    ZAtsJudgeOutput,
    "ATS",
    judgeValidationErrors
  );
  const engineerJudge = parseJudge(
    path.join(applicationDir, "judges", "engineer.json"),
    ZEngineerJudgeOutput,
    "Engineer",
    judgeValidationErrors
  );
  const hrJudge = parseJudge(
    path.join(applicationDir, "judges", "hr.json"),
    ZHrJudgeOutput,
    "HR",
    judgeValidationErrors
  );
  const status = stageStatus({ repoRoot: process.cwd(), applicationDir, style });
  const requiredFreshStages = [
    "persona",
    "job_analysis",
    "application_strategy",
    "tailor",
    "format",
    "validate_claims",
    "validate_artifact",
    "judge_ats",
    "judge_engineer",
    "judge_hr",
  ];
  const staleStages = requiredFreshStages.filter((stage) => !status.stages[stage]?.fresh);
  const pipelineErrors = staleStages.length
    ? [`Stale pipeline stages must be rebuilt: ${staleStages.join(", ")}.`]
    : [];
  const result = ZReleaseOutput.parse(evaluateQualityGate({
    applicationStrategy: readJson(path.join(applicationDir, "application-strategy.json")),
    strategyValidation: readJson(path.join(applicationDir, "validations", "strategy.json")),
    claimValidation: readJson(path.join(applicationDir, "validations", "claims.json")),
    artifactValidation: readJson(path.join(applicationDir, "validations", "artifact.json")),
    atsResults: readJson(path.join(applicationDir, "ats-results.json")),
    atsJudge,
    engineerJudge,
    hrJudge,
    expectedJudgeMetadata: expectedMetadata,
    artifactHash,
    artifactPath: path.relative(applicationDir, artifactPath),
    artifactType,
    judgeValidationErrors,
    pipelineErrors,
  }));
  const outputPath = path.join(applicationDir, "release.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.state === "blocked") process.exitCode = 2;
} catch (error) {
  process.stderr.write(`quality-gate error: ${error.message}\n`);
  process.exit(1);
}
