#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { rankAccomplishments } from "../lib/validate-accomplishments.js";
import { ZAccomplishmentBank } from "../schemas/accomplishments.js";
import { ZJobSpec } from "../schemas/job-spec.js";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const bankPath = process.argv[2];
const jobSpecPath = process.argv[3];
const outputPath = flag("--output");
const limit = Number(flag("--limit") ?? 0);

if (!bankPath || !jobSpecPath) {
  process.stderr.write(
    "Usage: labora rank-accomplishments <accomplishments.json> <job-spec.json> [--limit <n>] [--output <ranking.json>]\n"
  );
  process.exit(1);
}

// Ranking is advisory: it orders units by structured evidence so the strategy
// agent starts from a defensible shortlist instead of re-reading the ledger.
try {
  const bank = ZAccomplishmentBank.parse(JSON.parse(fs.readFileSync(bankPath, "utf8")));
  const jobSpec = ZJobSpec.parse(JSON.parse(fs.readFileSync(jobSpecPath, "utf8")));

  const jobTerms = [
    ...new Set(
      (jobSpec.requirements || []).flatMap((requirement) => [
        ...(requirement.canonicalTerms || []),
        ...(requirement.surfaceForms || []),
      ])
    ),
  ].filter(Boolean);

  const ranked = rankAccomplishments({ bank, jobTerms });
  const result = {
    jobTerms,
    ranking: limit > 0 ? ranked.slice(0, limit) : ranked,
  };

  const json = JSON.stringify(result, null, 2) + "\n";
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
} catch (error) {
  process.stderr.write(`rank-accomplishments error: ${error.message}\n`);
  process.exit(1);
}
