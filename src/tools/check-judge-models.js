#!/usr/bin/env node
// Reports which model backs the tailor and each judge, so model diversity is a
// checked fact rather than an assertion nobody can verify.
//
// Exit codes are three-valued on purpose:
//   0  at least one judge is configured on a model the tailor does not use
//   1  every judge shares the tailor's model, so verdicts are correlated
//   2  the configuration could not be read, so the answer is unknown
//
// 1 and 2 are not the same answer and must not be merged. Wire this into CI if
// you want diversity enforced; the release record only ever records it.
import { judgeModelReport, defaultSettingsPath } from "../lib/copilot-settings.js";
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const settingsIndex = args.indexOf("--settings");
const settingsPath = settingsIndex >= 0 ? args[settingsIndex + 1] : undefined;

if (settingsIndex >= 0 && !settingsPath) {
  process.stderr.write("Usage: labora check-judge-models [--json] [--settings <path>]\n");
  process.exit(2);
}

const report = judgeModelReport({ settingsPath: settingsPath || defaultSettingsPath() });

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  const name = (entry) => entry.model || (entry.source ? "(runtime default)" : "(unknown)");
  process.stdout.write(`settings: ${report.settingsPath} [${report.status}]\n`);
  if (report.error) process.stdout.write(`  error: ${report.error}\n`);
  if (report.diverse === null) {
    // No per-agent table: printing "same as tailor" beside an UNKNOWN verdict
    // states a fact about a file nobody managed to read.
    process.stdout.write(
      "\nverdict: UNKNOWN - the model configuration could not be read, so whether\n" +
      "         the judges share the tailor's model is unanswered, not answered 'no'.\n"
    );
  } else {
    process.stdout.write(`\n  ${report.tailor.agent.padEnd(16)} ${name(report.tailor)}  <- via ${report.tailor.source}\n`);
    for (const judge of report.judges) {
      const marker = judge.differsFromTailor ? "differs" : "same as tailor";
      process.stdout.write(`  ${judge.agent.padEnd(16)} ${name(judge)}  <- via ${judge.source}  (${marker})\n`);
    }
    process.stdout.write("\n");
    if (report.diverse) {
      process.stdout.write("verdict: DIVERSE - at least one judge is configured off the tailor's model.\n");
    } else {
      process.stdout.write(
        "verdict: NOT DIVERSE - every judge shares the tailor's model, so a blind spot\n" +
        "         in that model is shared by the tailor and all three judges.\n" +
        "         Configure per-agent models with /subagents, or in settings.json:\n" +
        '           { "subagents": { "agents": { "judge-engineer": { "model": "<other-model>" } } } }\n'
      );
    }
  }
  process.stdout.write(`\nnote: ${report.caveat}\n`);
}

process.exit(report.diverse === null ? 2 : (report.diverse ? 0 : 1));
