#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { validateResumeClaims } from "../lib/validate-resume-claims.js";
import { normalizeIdentity } from "../lib/normalize-identity.js";
import { personaRootFromProfileFile } from "../lib/storage.js";
import { ZAccomplishmentBank } from "../schemas/accomplishments.js";
import { ZClaimLedger } from "../schemas/provenance.js";
import { ZJobSpec } from "../schemas/job-spec.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";
import { ZApplicationStrategy } from "../schemas/application-strategy.js";

const resumePath = process.argv[2];
const identityPath = process.argv[3];
const ledgerPath = process.argv[4];
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
const bankIndex = process.argv.indexOf("--accomplishments");
const explicitBankPath = bankIndex >= 0 ? process.argv[bankIndex + 1] : null;
const jobSpecIndex = process.argv.indexOf("--job-spec");
const explicitJobSpecPath = jobSpecIndex >= 0 ? process.argv[jobSpecIndex + 1] : null;
const strategyIndex = process.argv.indexOf("--application-strategy");
const explicitStrategyPath = strategyIndex >= 0 ? process.argv[strategyIndex + 1] : null;
if (!resumePath || !identityPath || !ledgerPath) {
  process.stderr.write("Usage: labora validate-claims <resume.json> <identity.json> <claims.json> [--accomplishments <accomplishments.json>] [--job-spec <job-spec.json>] [--application-strategy <application-strategy.json>]\n");
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
  // The spec sits beside the resume in the application directory, so the
  // default path needs no extra flag either. Absent, headline collision and
  // posting-vocabulary diagnostics stay silent rather than guessing.
  const jobSpecPath = explicitJobSpecPath || path.join(path.dirname(resumePath), "job-spec.json");
  const jobSpec = fs.existsSync(jobSpecPath)
    ? ZJobSpec.parse(JSON.parse(fs.readFileSync(jobSpecPath, "utf8")))
    : null;
  const strategyPath = explicitStrategyPath || path.join(path.dirname(resumePath), "application-strategy.json");
  const applicationStrategy = fs.existsSync(strategyPath)
    ? ZApplicationStrategy.parse(JSON.parse(fs.readFileSync(strategyPath, "utf8")))
    : null;
  const result = validateResumeClaims({
    resume,
    identity,
    ledger,
    bank,
    jobSpec,
    applicationStrategy,
    workspaceRoot: process.cwd(),
    personaRoot: personaRootFromProfileFile(identityPath),
  });
  const json = JSON.stringify(result, null, 2) + "\n";
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
  // Two distinct non-zero codes, because the two situations have different next
  // steps. Neither is success: a caller that only checks for zero keeps its
  // current behavior, and a caller that wants to continue review work has to
  // ask for exit 3 deliberately.
  //
  //   2  unsupported assertion -- the resume outruns the evidence. Fix content.
  //   3  stale derived record  -- profile/generated/ is behind its source.
  //                              Rebuild it; review work may continue.
  if (!result.valid) {
    const reviewOnly = result.state === "review_only";
    process.exitCode = reviewOnly ? 3 : 2;
    if (reviewOnly && result.rebuildPacket) {
      const packet = result.rebuildPacket;
      process.stderr.write(
        `\nPROFILE REBUILD REQUIRED -- ${packet.records.length} stale record(s), no unsupported content.\n` +
        `  owner:    ${packet.owner} (only it may write profile/generated/)\n` +
        `  action:   ${packet.requiredAction}\n` +
        `  deferred: ${packet.blocks.join(", ")}\n` +
        `  continue: ${packet.allows.join(", ")}\n` +
        packet.records.map((record) => `  - ${record.location}: ${record.code}\n`).join("") +
        `\nThis resume is UNVALIDATED and cannot be released until the rebuild lands.\n`
      );
    }
  }
} catch (error) {
  process.stderr.write(`validate-claims error: ${error.message}\n`);
  process.exit(1);
}
