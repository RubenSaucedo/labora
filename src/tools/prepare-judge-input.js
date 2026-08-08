#!/usr/bin/env node
import path from "node:path";
import { prepareJudgeInput } from "../lib/judge-input.js";

const judge = process.argv[2];
const applicationDir = process.argv[3];
const artifactPath = process.argv[4];

if (!judge || !applicationDir || !artifactPath) {
  process.stderr.write(
    "Usage: node src/tools/prepare-judge-input.js <ats|engineer|hr> <application-dir> <artifact.docx|artifact.pdf>\n"
  );
  process.exit(1);
}

try {
  const result = await prepareJudgeInput({
    applicationDir,
    artifactPath,
    judge,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  process.stderr.write(`prepare-judge-input error: ${error.message}\n`);
  process.exit(1);
}
