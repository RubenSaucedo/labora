#!/usr/bin/env node
import path from "node:path";
import { recordStage, stageStatus } from "../lib/run-manifest.js";

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const command = process.argv[2];
const applicationArg = process.argv[3];
if (!["check", "record"].includes(command) || !applicationArg) {
  process.stderr.write(
    "Usage: labora run-state check <application-dir> [--style N]\n" +
    "       labora run-state record <application-dir> <stage> [--style N] [--model ID]\n"
  );
  process.exit(1);
}

const applicationDir = path.resolve(applicationArg);
const style = Number(flag("--style", "1"));

try {
  if (command === "check") {
    process.stdout.write(JSON.stringify(stageStatus({ applicationDir, style }), null, 2) + "\n");
  } else {
    const stage = process.argv[4];
    const result = recordStage({
      applicationDir,
      stage,
      style,
      model: flag("--model", ""),
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
} catch (error) {
  process.stderr.write(`run-state error: ${error.message}\n`);
  process.exit(1);
}

