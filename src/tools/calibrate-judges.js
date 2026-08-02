#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { calibrateJudges } from "../lib/judge-calibration.js";
import { ZJudgeCalibration } from "../schemas/judge-calibration.js";
import {
  ZAtsJudgeOutput,
  ZEngineerJudgeOutput,
  ZHrJudgeOutput,
} from "../schemas/judge-output.js";

/**
 * Aggregate historical judge outputs into a calibration report so verdict/score
 * drift, per-model bias, and cross-judge agreement are observable over time.
 *
 * Usage:
 *   node src/tools/calibrate-judges.js [--personas <dir>] [--persona <name>] \
 *     [--out <calibration.json>]
 *
 * Walks data/personas/<persona>/applications/<slug>/judges/{ats,engineer,hr}.json.
 * Malformed judge files are skipped and counted, never fatal.
 */
function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const JUDGE_SCHEMAS = {
  ats: ZAtsJudgeOutput,
  engineer: ZEngineerJudgeOutput,
  hr: ZHrJudgeOutput,
};

const personasDir = path.resolve(flag("--personas", path.join("data", "personas")));
const onlyPersona = flag("--persona");
const outPath = flag("--out");

try {
  if (!fs.existsSync(personasDir)) {
    throw new Error(`Personas directory not found: ${personasDir}`);
  }

  const personaNames = onlyPersona
    ? [onlyPersona]
    : fs.readdirSync(personasDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

  const records = [];
  let skipped = 0;
  for (const persona of personaNames) {
    const applicationsDir = path.join(personasDir, persona, "applications");
    if (!fs.existsSync(applicationsDir)) continue;
    for (const slug of fs.readdirSync(applicationsDir)) {
      const judgesDir = path.join(applicationsDir, slug, "judges");
      if (!fs.existsSync(judgesDir)) continue;
      for (const judge of Object.keys(JUDGE_SCHEMAS)) {
        const filePath = path.join(judgesDir, `${judge}.json`);
        if (!fs.existsSync(filePath)) continue;
        let parsed;
        try {
          parsed = JUDGE_SCHEMAS[judge].safeParse(JSON.parse(fs.readFileSync(filePath, "utf8")));
        } catch {
          parsed = { success: false };
        }
        if (!parsed.success) {
          skipped += 1;
          continue;
        }
        records.push({ application: `${persona}/${slug}`, persona, judge, output: parsed.data });
      }
    }
  }

  const report = ZJudgeCalibration.parse(calibrateJudges(records));
  const json = JSON.stringify(report, null, 2) + "\n";
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), json);
  }
  process.stdout.write(json);
  process.stderr.write(
    `calibrate-judges: ${records.length} judge output(s) across ${report.applicationCount} application(s)` +
      (skipped ? `, ${skipped} skipped (invalid)` : "") + "\n"
  );
} catch (error) {
  process.stderr.write(`calibrate-judges error: ${error.message}\n`);
  process.exit(1);
}
