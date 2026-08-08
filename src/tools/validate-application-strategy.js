#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { validateApplicationStrategy } from "../lib/application-strategy.js";
import { ZApplicationStrategy } from "../schemas/application-strategy.js";
import { ZJobSpec } from "../schemas/job-spec.js";
import { ZClaimLedger } from "../schemas/provenance.js";
import { ZAccomplishmentBank } from "../schemas/accomplishments.js";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const strategyPath = process.argv[2];
const jobSpecPath = process.argv[3];
const claimsPath = process.argv[4];
const outputPath = flag("--output");
const bankPath = flag("--accomplishments");

if (!strategyPath || !jobSpecPath || !claimsPath) {
  process.stderr.write(
    "Usage: labora validate-application-strategy <application-strategy.json> <job-spec.json> <claims.json> [--accomplishments <accomplishments.json>] [--output <validation.json>]\n"
  );
  process.exit(1);
}

try {
  const strategy = ZApplicationStrategy.parse(JSON.parse(fs.readFileSync(strategyPath, "utf8")));
  const jobSpec = ZJobSpec.parse(JSON.parse(fs.readFileSync(jobSpecPath, "utf8")));
  const claimLedger = ZClaimLedger.parse(JSON.parse(fs.readFileSync(claimsPath, "utf8")));
  const bank = bankPath
    ? ZAccomplishmentBank.parse(JSON.parse(fs.readFileSync(bankPath, "utf8")))
    : null;
  const result = validateApplicationStrategy({ strategy, jobSpec, claimLedger, bank });
  const json = JSON.stringify(result, null, 2) + "\n";
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
  if (!result.valid) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`validate-application-strategy error: ${error.message}\n`);
  process.exit(1);
}
