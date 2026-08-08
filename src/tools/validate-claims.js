#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { validateResumeClaims } from "../lib/validate-resume-claims.js";
import { normalizeIdentity } from "../lib/normalize-identity.js";
import { personaRootFromProfileFile } from "../lib/storage.js";
import { ZAccomplishmentBank } from "../schemas/accomplishments.js";
import { ZClaimLedger } from "../schemas/provenance.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";

const resumePath = process.argv[2];
const identityPath = process.argv[3];
const ledgerPath = process.argv[4];
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
const bankIndex = process.argv.indexOf("--accomplishments");
const explicitBankPath = bankIndex >= 0 ? process.argv[bankIndex + 1] : null;
if (!resumePath || !identityPath || !ledgerPath) {
  process.stderr.write("Usage: labora validate-claims <resume.json> <identity.json> <claims.json> [--accomplishments <accomplishments.json>]\n");
  process.exit(1);
}

try {
  const resume = ZTailoredResume.parse(JSON.parse(fs.readFileSync(resumePath, "utf8")));
  const identity = normalizeIdentity(JSON.parse(fs.readFileSync(identityPath, "utf8")));
  // The bank sits beside the identity record in profile/generated/, so the
  // default path needs no extra flag.
  const bankPath = explicitBankPath
    || path.join(path.dirname(identityPath), "accomplishments.json");
  const bank = fs.existsSync(bankPath)
    ? ZAccomplishmentBank.parse(JSON.parse(fs.readFileSync(bankPath, "utf8")))
    : null;
  const ledger = ZClaimLedger.parse(JSON.parse(fs.readFileSync(ledgerPath, "utf8")));
  const result = validateResumeClaims({
    resume,
    identity,
    ledger,
    bank,
    workspaceRoot: process.cwd(),
    personaRoot: personaRootFromProfileFile(identityPath),
  });
  const json = JSON.stringify(result, null, 2) + "\n";
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
  if (!result.valid) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`validate-claims error: ${error.message}\n`);
  process.exit(1);
}
