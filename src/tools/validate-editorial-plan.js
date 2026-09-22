#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ZEditorialPlan } from "../schemas/editorial.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";
import { ZClaimLedger } from "../schemas/provenance.js";
import { ZAccomplishmentBank } from "../schemas/accomplishments.js";
import { validateEditorialPlan } from "../lib/editorial-plan.js";
import { baselineEditorialView, evaluateBaseline, readBaselineContract, sha256 } from "../lib/editorial-baseline.js";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const planPath = process.argv[2];
const resumePath = process.argv[3];
const claimsPath = process.argv[4];
const applicationDir = flag("--application");
const baselinePath = flag("--baseline");
const bankPath = flag("--accomplishments");
const outputPath = flag("--output");

if (!planPath || !resumePath || !claimsPath || (!applicationDir && !baselinePath)) {
  process.stderr.write(
    "Usage: labora validate-editorial-plan <editorial-plan.json> <resume.json> <claims.json>\n" +
    "         (--application <application-dir> | --baseline <resume-approved.json>)\n" +
    "         [--accomplishments <accomplishments.json>] [--output <validation.json>]\n"
  );
  process.exit(1);
}

try {
  const plan = ZEditorialPlan.parse(JSON.parse(fs.readFileSync(planPath, "utf8")));
  const revised = ZTailoredResume.parse(JSON.parse(fs.readFileSync(resumePath, "utf8")));
  const claimLedger = ZClaimLedger.parse(JSON.parse(fs.readFileSync(claimsPath, "utf8")));
  const bank = bankPath ? ZAccomplishmentBank.parse(JSON.parse(fs.readFileSync(bankPath, "utf8"))) : null;

  let baselineFile = baselinePath;
  let contract = null;
  if (applicationDir) {
    contract = readBaselineContract(path.resolve(applicationDir));
    if (!contract) {
      process.stderr.write(
        `no baseline recorded in ${applicationDir}. An editorial plan describes changes to an approved\n` +
        "document; without one there is nothing for it to preserve. Run `labora baseline` first.\n"
      );
      process.exit(1);
    }
    baselineFile = path.isAbsolute(contract.path)
      ? contract.path
      : path.resolve(applicationDir, contract.path);
  }

  const bytes = fs.readFileSync(baselineFile);
  const status = contract ? evaluateBaseline({ contract, bytes }) : { usable: true, approved: true, actualHash: sha256(bytes) };
  const baselineView = baselineEditorialView(JSON.parse(bytes.toString("utf8")));

  const result = validateEditorialPlan({
    plan,
    baselineView,
    revised,
    claimLedger,
    bank,
    baselineApproved: status.approved,
    baselineHash: status.actualHash,
  });

  if (contract && !status.usable) {
    result.valid = false;
    result.issues.unshift({
      severity: "error",
      code: "baseline_unusable",
      location: "baselineResume",
      message: `Baseline "${contract.path}": ${status.reason}`,
    });
  }

  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
  if (!result.valid) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`validate-editorial-plan error: ${error.message}\n`);
  process.exit(1);
}
