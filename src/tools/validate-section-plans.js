#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ZExperiencePlan, ZSkillsPlan, ZProjectsPlan } from "../schemas/section-plans.js";
import { ZTailoredResume } from "../schemas/tailored-resume.js";
import { ZClaimLedger } from "../schemas/provenance.js";
import { ZAccomplishmentBank } from "../schemas/accomplishments.js";
import {
  revalidateDependents,
  validateExperiencePlan,
  validateProjectsPlan,
  validateSkillsPlan,
} from "../lib/section-plans.js";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const resumePath = process.argv[2];
if (!resumePath || resumePath.startsWith("--")) {
  process.stderr.write(
    "Usage: labora validate-section-plans <resume.json> [--claims <claims.json>]\n" +
    "         [--accomplishments <accomplishments.json>] [--experience-plan <f>] [--skills-plan <f>]\n" +
    "         [--projects-plan <f>] [--removed <location,location>] [--output <validation.json>]\n"
  );
  process.exit(1);
}

const read = (file, schema) => (file ? schema.parse(JSON.parse(fs.readFileSync(file, "utf8"))) : null);

try {
  const resume = ZTailoredResume.parse(JSON.parse(fs.readFileSync(resumePath, "utf8")));
  const claimLedger = read(flag("--claims"), ZClaimLedger);
  const bank = read(flag("--accomplishments"), ZAccomplishmentBank);
  const experiencePlan = read(flag("--experience-plan"), ZExperiencePlan);
  const skillsPlan = read(flag("--skills-plan"), ZSkillsPlan);
  const projectsPlan = read(flag("--projects-plan"), ZProjectsPlan);
  const removedLocations = (flag("--removed") || "").split(",").map((entry) => entry.trim()).filter(Boolean);

  const sections = {};
  if (experiencePlan) sections.experience = validateExperiencePlan({ plan: experiencePlan, bank, claimLedger, resume });
  if (skillsPlan) sections.skills = validateSkillsPlan({ plan: skillsPlan, claimLedger, resume });
  if (projectsPlan) sections.projects = validateProjectsPlan({ plan: projectsPlan, claimLedger, resume });

  // Always run, even when only one plan was supplied: the dependency rule is
  // the whole point of validating these together, and a skill whose only proof
  // has been cut is invisible to the plan that still lists it.
  const dependents = revalidateDependents({ skillsPlan, projectsPlan, resume, removedLocations });

  const issues = [...Object.values(sections).flatMap((entry) => entry.issues), ...dependents.issues];
  const warnings = [...Object.values(sections).flatMap((entry) => entry.warnings), ...dependents.warnings];
  const result = {
    schemaVersion: "1.0",
    valid: issues.length === 0,
    sections,
    dependents,
    issues,
    warnings,
  };

  const json = `${JSON.stringify(result, null, 2)}\n`;
  const outputPath = flag("--output");
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
  }
  process.stdout.write(json);
  if (!result.valid) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`validate-section-plans error: ${error.message}\n`);
  process.exit(1);
}
