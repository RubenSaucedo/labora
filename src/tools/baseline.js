#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  BASELINE_FILE,
  baselineContractFor,
  evaluateBaseline,
  readBaselineContract,
  writeBaselineContract,
} from "../lib/editorial-baseline.js";

/**
 * Record or check the approved baseline for one application.
 *
 * Recording is an operator act, like approval, and for the same reason: saying
 * "this is the wording a person reviewed" is a claim about a human decision,
 * and nothing else in the pipeline is in a position to make it.
 *
 * `--check` is the read-only half, and it is the one that runs on every
 * subsequent tailoring pass.
 */

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : fallback;
}

const hasFlag = (name) => process.argv.includes(name);

function usage() {
  process.stderr.write(
    "Usage: labora baseline <application-dir> --record <resume-approved.json> [--approved-by-operator] [--note <text>]\n" +
    "       labora baseline <application-dir> --check\n"
  );
  process.exit(1);
}

const applicationArg = process.argv[2];
if (!applicationArg || applicationArg.startsWith("--")) usage();
const applicationDir = path.resolve(applicationArg);

try {
  if (hasFlag("--record")) {
    const target = flag("--record");
    if (!target) usage();
    const resolved = path.isAbsolute(target) ? target : path.resolve(applicationDir, target);
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`baseline: no such file: ${target}\n`);
      process.exit(1);
    }
    const bytes = fs.readFileSync(resolved);
    JSON.parse(bytes.toString("utf8"));

    const operator = hasFlag("--approved-by-operator");
    const contract = baselineContractFor({
      filePath: path.relative(applicationDir, resolved) || path.basename(resolved),
      bytes,
      approval: operator ? "operator" : "unreviewed",
      approvedAt: operator ? new Date().toISOString() : "",
      note: flag("--note", "") || "",
    });
    writeBaselineContract(applicationDir, contract);
    process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
    if (!operator) {
      process.stdout.write(
        "\nRecorded without operator approval. Its wording is a starting point, not a constraint.\n" +
        "Re-run with --approved-by-operator once a person has reviewed it.\n"
      );
    }
    process.exit(0);
  }

  const contract = readBaselineContract(applicationDir);
  if (!contract) {
    process.stdout.write(
      `no ${BASELINE_FILE} in ${applicationArg}; this application generates from evidence with no baseline.\n`
    );
    process.exit(0);
  }
  const resolved = path.isAbsolute(contract.path)
    ? contract.path
    : path.resolve(applicationDir, contract.path);
  const bytes = fs.existsSync(resolved) ? fs.readFileSync(resolved) : null;
  const status = evaluateBaseline({ contract, bytes });
  const result = { schemaVersion: "1.0", contract, ...status };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  // A changed or unreadable baseline is reported, never silently ignored: the
  // editorial guarantees all rest on the bytes being the ones that were read.
  if (!status.usable) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`baseline error: ${error.message}\n`);
  process.exit(1);
}
