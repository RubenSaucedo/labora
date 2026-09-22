#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ZTailoredResume } from "../schemas/tailored-resume.js";
import { ZJobSpec } from "../schemas/job-spec.js";
import { ZClaimLedger } from "../schemas/provenance.js";
import { ZEditorialPlan } from "../schemas/editorial.js";
import { ZExperiencePlan } from "../schemas/section-plans.js";
import { auditDocument } from "../lib/document-audit.js";
import { ZMetricContext } from "../lib/metric-context.js";
import { baselineEditorialView, readBaselineContract } from "../lib/editorial-baseline.js";

/**
 * The whole-document pass, run after section drafting and before rendering.
 *
 * Exit code 0 even when it reports findings. Everything it notices is
 * editorial: a repeated opening is not a lie, and a tool that refused to
 * continue over cadence would have taken authority it has no basis for. Exit 2
 * is reserved for the placement checks that cross an evidence boundary.
 */

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const resumePath = process.argv[2];
if (!resumePath || resumePath.startsWith("--")) {
  process.stderr.write(
    "Usage: labora audit-document <resume.json> [--job-spec <job-spec.json>] [--claims <claims.json>]\n" +
    "         [--application <application-dir>] [--editorial-plan <editorial-plan.json>]\n" +
    "         [--experience-plan <experience-plan.json>] [--metric-contexts <metric-contexts.json>]\n" +
    "         [--job <job.md>] [--output <audit.json>]\n"
  );
  process.exit(1);
}

const read = (file, schema) => (file ? schema.parse(JSON.parse(fs.readFileSync(file, "utf8"))) : null);

try {
  const resume = ZTailoredResume.parse(JSON.parse(fs.readFileSync(resumePath, "utf8")));
  const jobSpec = read(flag("--job-spec"), ZJobSpec);
  const claimLedger = read(flag("--claims"), ZClaimLedger);
  const editorialPlan = read(flag("--editorial-plan"), ZEditorialPlan);
  const experiencePlan = read(flag("--experience-plan"), ZExperiencePlan);
  const metricContextsPath = flag("--metric-contexts");
  const metricContexts = metricContextsPath
    ? z.array(ZMetricContext).parse(JSON.parse(fs.readFileSync(metricContextsPath, "utf8")))
    : [];
  const jobPath = flag("--job");
  const postingText = jobPath ? fs.readFileSync(jobPath, "utf8") : "";

  let baselineView = null;
  const applicationDir = flag("--application");
  if (applicationDir) {
    const contract = readBaselineContract(path.resolve(applicationDir));
    if (contract) {
      const resolved = path.isAbsolute(contract.path)
        ? contract.path
        : path.resolve(applicationDir, contract.path);
      if (fs.existsSync(resolved)) {
        baselineView = baselineEditorialView(JSON.parse(fs.readFileSync(resolved, "utf8")));
      }
    }
  }

  const result = auditDocument({
    resume,
    baselineView,
    editorialPlan,
    jobSpec,
    claimLedger,
    experiencePlan,
    metricContexts,
    postingText,
  });

  const json = `${JSON.stringify(result, null, 2)}\n`;
  const outputPath = flag("--output");
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
  if (!result.valid) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`audit-document error: ${error.message}\n`);
  process.exit(1);
}
