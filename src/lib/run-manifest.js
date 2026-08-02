import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STAGE_DEPENDENCIES = {
  persona: [],
  job_analysis: [],
  application_strategy: ["persona", "job_analysis"],
  tailor: ["application_strategy"],
  format: ["tailor"],
  validate_claims: ["persona", "tailor"],
  validate_artifact: ["format"],
  judge_ats: ["job_analysis", "format", "validate_artifact"],
  judge_engineer: ["job_analysis", "format", "validate_artifact"],
  judge_hr: ["job_analysis", "format", "validate_artifact"],
  quality_gate: [
    "application_strategy",
    "tailor",
    "validate_claims",
    "validate_artifact",
    "judge_ats",
    "judge_engineer",
    "judge_hr",
  ],
};

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileHash(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return hashBuffer(fs.readFileSync(filePath));
}

function directoryFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...directoryFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files.sort();
}

function fingerprint(paths, root) {
  const parts = [];
  for (const target of paths) {
    if (!target) continue;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      const files = directoryFiles(target);
      if (!files.length) parts.push(`${path.relative(root, target)}:EMPTY`);
      for (const file of files) parts.push(`${path.relative(root, file)}:${fileHash(file)}`);
    } else {
      parts.push(`${path.relative(root, target)}:${fileHash(target) || "MISSING"}`);
    }
  }
  return hashBuffer(Buffer.from(parts.join("\n")));
}

function evidenceValidationStatus(personaRoot) {
  const base = path.join(personaRoot, "evidence", "performance-reviews");
  if (!fs.existsSync(base)) return { valid: true, issues: [] };
  const rawFiles = directoryFiles(base).filter((file) => {
    if (!/\.pdf$/i.test(file)) return false;
    return path.relative(base, file).split(path.sep).includes("raw");
  });
  const issues = [];
  for (const rawPath of rawFiles) {
    const segments = path.relative(base, rawPath).split(path.sep);
    const rawIndex = segments.lastIndexOf("raw");
    const layout = segments.slice(0, rawIndex);
    const relative = segments.slice(rawIndex + 1).join(path.sep).replace(/\.pdf$/i, "");
    const outputBase = path.join(base, ...layout);
    const extractedPath = path.join(outputBase, "extracted", `${relative}.md`);
    const metadataPath = path.join(outputBase, "extracted", `${relative}.json`);
    const cleanedPath = path.join(outputBase, "text", `${relative}.md`);
    const validationPath = path.join(outputBase, "validations", `${relative}.json`);
    const required = [extractedPath, metadataPath, cleanedPath, validationPath];
    const missing = required.filter((file) => !fs.existsSync(file));
    if (missing.length) {
      issues.push(`Missing evidence outputs for ${path.relative(personaRoot, rawPath)}.`);
      continue;
    }
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      const validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));
      const sourceHash = fileHash(rawPath);
      const extractedHash = fileHash(extractedPath);
      const cleanedHash = fileHash(cleanedPath);
      if (!validation.valid) issues.push(`Evidence cleaning failed for ${relative}.`);
      if (
        metadata.sourceHash !== sourceHash ||
        metadata.extractedHash !== extractedHash ||
        validation.bindings?.sourceHash !== sourceHash ||
        validation.bindings?.extractedHash !== extractedHash ||
        validation.bindings?.cleanedHash !== cleanedHash
      ) {
        issues.push(`Evidence hashes are stale for ${relative}.`);
      }
    } catch {
      issues.push(`Evidence metadata or validation is unreadable for ${relative}.`);
    }
  }
  return { valid: issues.length === 0, issues };
}

export function stageDefinitions({ repoRoot, personaRoot, applicationDir, style }) {
  const profile = path.join(personaRoot, "profile");
  // resume-persona owns everything under generated/; every other stage reads it.
  const generated = path.join(profile, "generated");
  const evidence = path.join(personaRoot, "evidence", "performance-reviews");
  const repositories = path.join(personaRoot, "evidence", "repositories");
  const judges = path.join(applicationDir, "judges");
  const validations = path.join(applicationDir, "validations");
  const docx = path.join(applicationDir, `final-resume-style-${style}.docx`);
  const pdf = path.join(applicationDir, `final-resume-style-${style}.pdf`);
  const previews = path.join(applicationDir, "previews");
  const renderedArtifacts = [docx, ...(fs.existsSync(pdf) ? [pdf] : [])];

  return {
    persona: {
      dependencies: [
        path.join(profile, "career.md"),
        path.join(profile, "background.md"),
        evidence,
        repositories,
        path.join(repoRoot, "skills", "resume-persona", "SKILL.md"),
        path.join(repoRoot, "src", "lib", "evidence-cleaning.js"),
        path.join(repoRoot, "src", "tools", "validate-evidence-cleaning.js"),
        path.join(repoRoot, "src", "schemas", "identity.js"),
        path.join(repoRoot, "src", "schemas", "provenance.js"),
        path.join(repoRoot, "src", "schemas", "accomplishments.js"),
        path.join(repoRoot, "src", "lib", "validate-accomplishments.js"),
        path.join(repoRoot, "src", "lib", "normalize-identity.js"),
      ],
      outputs: [
        path.join(generated, "identity.json"),
        path.join(generated, "claims.json"),
        path.join(generated, "accomplishments.json"),
      ],
    },
    job_analysis: {
      dependencies: [
        path.join(applicationDir, "job.md"),
        path.join(repoRoot, "skills", "resume-job-analysis", "SKILL.md"),
        path.join(repoRoot, "src", "lib", "job-requirements.js"),
        path.join(repoRoot, "src", "lib", "skill-aliases.js"),
        path.join(repoRoot, "src", "schemas", "job-spec.js"),
      ],
      outputs: [path.join(applicationDir, "job-spec.json")],
    },
    application_strategy: {
      dependencies: [
        path.join(generated, "claims.json"),
        path.join(generated, "accomplishments.json"),
        path.join(profile, "career.md"),
        path.join(profile, "background.md"),
        path.join(applicationDir, "job.md"),
        path.join(applicationDir, "job-spec.json"),
        path.join(repoRoot, "skills", "resume-application-strategy", "SKILL.md"),
        path.join(repoRoot, "src", "lib", "application-strategy.js"),
        path.join(repoRoot, "src", "lib", "eligibility.js"),
        path.join(repoRoot, "src", "schemas", "application-strategy.js"),
        path.join(repoRoot, "src", "tools", "validate-application-strategy.js"),
      ],
      outputs: [
        path.join(applicationDir, "application-strategy.json"),
        path.join(validations, "strategy.json"),
      ],
    },
    tailor: {
      dependencies: [
        path.join(generated, "identity.json"),
        path.join(generated, "claims.json"),
        path.join(generated, "accomplishments.json"),
        path.join(applicationDir, "job.md"),
        path.join(applicationDir, "job-spec.json"),
        path.join(applicationDir, "application-strategy.json"),
        path.join(validations, "strategy.json"),
        path.join(repoRoot, "skills", "resume-tailor", "SKILL.md"),
        path.join(repoRoot, "src", "lib", "score-resume-ats.js"),
        path.join(repoRoot, "src", "lib", "eligibility.js"),
        path.join(repoRoot, "src", "schemas", "tailored-resume.js"),
        path.join(repoRoot, "src", "schemas", "provenance.js"),
      ],
      outputs: [path.join(applicationDir, "resume.json"), path.join(applicationDir, "ats-results.json")],
    },
    format: {
      dependencies: [
        path.join(applicationDir, "resume.json"),
        path.join(profile, "contact.md"),
        path.join(repoRoot, "src", "agents", "format-resume.js"),
        path.join(repoRoot, "src", "tools", "format-docx.js"),
        path.join(repoRoot, "src", "tools", "format-pdf.js"),
        path.join(repoRoot, "src", "tools", "render-artifact-preview.js"),
        path.join(repoRoot, "src", "lib", "profile-contact.js"),
        path.join(repoRoot, "src", "schemas", "tailored-resume.js"),
      ],
      outputs: renderedArtifacts,
    },
    validate_claims: {
      dependencies: [
        path.join(applicationDir, "resume.json"),
        path.join(generated, "identity.json"),
        path.join(generated, "accomplishments.json"),
        path.join(repoRoot, "src", "lib", "skill-vocabulary.js"),
        path.join(repoRoot, "src", "lib", "normalize-identity.js"),
        path.join(generated, "claims.json"),
        path.join(repoRoot, "src", "lib", "validate-resume-claims.js"),
        path.join(repoRoot, "src", "schemas", "provenance.js"),
      ],
      outputs: [path.join(validations, "claims.json")],
    },
    validate_artifact: {
      dependencies: [
        path.join(applicationDir, "resume.json"),
        path.join(profile, "contact.md"),
        ...renderedArtifacts,
        path.join(repoRoot, "src", "lib", "validate-artifact.js"),
        path.join(repoRoot, "src", "tools", "validate-artifact.js"),
        path.join(repoRoot, "src", "agents", "format-resume.js"),
        path.join(applicationDir, "job.md"),
      ],
      outputs: [path.join(validations, "artifact.json")],
    },
    judge_ats: {
      dependencies: [
        ...renderedArtifacts,
        path.join(applicationDir, "job.md"),
        path.join(applicationDir, "ats-results.json"),
        path.join(repoRoot, "skills", "resume-conventions", "SKILL.md"),
        path.join(repoRoot, "agents", "judge-ats.agent.md"),
        path.join(repoRoot, "skills", "judge-ats", "SKILL.md"),
        path.join(repoRoot, "src", "schemas", "judge-output.js"),
        path.join(repoRoot, "src", "lib", "judge-input.js"),
        path.join(repoRoot, "src", "tools", "prepare-judge-input.js"),
        path.join(repoRoot, "src", "utils", "docx-to-text.js"),
        path.join(repoRoot, "src", "utils", "pdf-to-md.js"),
      ],
      outputs: [path.join(judges, "ats.json")],
    },
    judge_engineer: {
      dependencies: [
        ...renderedArtifacts,
        path.join(applicationDir, "job.md"),
        path.join(repoRoot, "skills", "resume-conventions", "SKILL.md"),
        path.join(repoRoot, "agents", "judge-engineer.agent.md"),
        path.join(repoRoot, "skills", "judge-engineer", "SKILL.md"),
        path.join(repoRoot, "src", "schemas", "judge-output.js"),
        path.join(repoRoot, "src", "lib", "judge-input.js"),
        path.join(repoRoot, "src", "tools", "prepare-judge-input.js"),
        path.join(repoRoot, "src", "utils", "docx-to-text.js"),
        path.join(repoRoot, "src", "utils", "pdf-to-md.js"),
      ],
      outputs: [path.join(judges, "engineer.json")],
    },
    judge_hr: {
      dependencies: [
        ...renderedArtifacts,
        path.join(applicationDir, "job.md"),
        path.join(repoRoot, "skills", "resume-conventions", "SKILL.md"),
        path.join(repoRoot, "agents", "judge-hr.agent.md"),
        path.join(repoRoot, "skills", "judge-hr", "SKILL.md"),
        path.join(repoRoot, "src", "schemas", "judge-output.js"),
        path.join(repoRoot, "src", "lib", "judge-input.js"),
        path.join(repoRoot, "src", "tools", "prepare-judge-input.js"),
        path.join(repoRoot, "src", "utils", "docx-to-text.js"),
        path.join(repoRoot, "src", "utils", "pdf-to-md.js"),
        previews,
      ],
      outputs: [path.join(judges, "hr.json")],
    },
    quality_gate: {
      dependencies: [
        path.join(applicationDir, "application-strategy.json"),
        path.join(validations, "strategy.json"),
        path.join(validations, "claims.json"),
        path.join(validations, "artifact.json"),
        path.join(applicationDir, "ats-results.json"),
        judges,
        path.join(repoRoot, "src", "lib", "quality-gate.js"),
        path.join(repoRoot, "src", "tools", "quality-gate.js"),
        path.join(repoRoot, "src", "schemas", "judge-output.js"),
        path.join(repoRoot, "src", "schemas", "release-output.js"),
      ],
      outputs: [path.join(applicationDir, "release.json")],
    },
  };
}

export function manifestPath(applicationDir) {
  return path.join(applicationDir, "run.json");
}

export function readManifest(applicationDir) {
  const target = manifestPath(applicationDir);
  if (!fs.existsSync(target)) {
    return { schemaVersion: "1.0", style: null, stages: {} };
  }
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

export function stageStatus({ repoRoot, applicationDir, style = 1 }) {
  const personaRoot = path.dirname(path.dirname(applicationDir));
  const definitions = stageDefinitions({ repoRoot, personaRoot, applicationDir, style });
  const manifest = readManifest(applicationDir);
  const stages = {};
  const evidenceStatus = evidenceValidationStatus(personaRoot);

  for (const [name, definition] of Object.entries(definitions)) {
    const currentFingerprint = fingerprint(definition.dependencies, repoRoot);
    const outputHashes = Object.fromEntries(
      definition.outputs.map((output) => [path.relative(repoRoot, output), fileHash(output)])
    );
    const recorded = manifest.stages?.[name];
    const outputsPresent = Object.values(outputHashes).every(Boolean);
    const outputsUnchanged = recorded &&
      Object.keys(recorded.outputHashes || {}).length === Object.keys(outputHashes).length &&
      Object.entries(outputHashes).every(
        ([output, hash]) => recorded.outputHashes?.[output] === hash
      );
    const assuranceValid = name !== "persona" || evidenceStatus.valid;
    stages[name] = {
      selfFresh: Boolean(
        recorded &&
        outputsPresent &&
        outputsUnchanged &&
        recorded.fingerprint === currentFingerprint &&
        assuranceValid
      ),
      outputsPresent,
      assuranceValid,
      assuranceIssues: name === "persona" ? evidenceStatus.issues : [],
      fingerprint: currentFingerprint,
      outputs: outputHashes,
      dependencies: STAGE_DEPENDENCIES[name] || [],
    };
  }

  for (const [name, stage] of Object.entries(stages)) {
    stage.dependenciesFresh = stage.dependencies.every((dependency) => stages[dependency]?.fresh);
    stage.fresh = stage.selfFresh && stage.dependenciesFresh;
  }

  return { schemaVersion: "1.0", style, stages };
}

export function recordStage({ repoRoot, applicationDir, stage, style = 1, model = "" }) {
  const status = stageStatus({ repoRoot, applicationDir, style });
  if (!status.stages[stage]) throw new Error(`Unknown stage "${stage}".`);
  if (!status.stages[stage].outputsPresent) throw new Error(`Stage "${stage}" outputs are incomplete.`);
  if (!status.stages[stage].assuranceValid) {
    throw new Error(
      `Stage "${stage}" assurance checks failed: ${status.stages[stage].assuranceIssues.join(" ")}`
    );
  }
  if (!status.stages[stage].dependenciesFresh) {
    throw new Error(`Stage "${stage}" has stale upstream dependencies.`);
  }

  const manifest = readManifest(applicationDir);
  manifest.schemaVersion = "1.0";
  manifest.style = style;
  manifest.stages ||= {};
  manifest.stages[stage] = {
    fingerprint: status.stages[stage].fingerprint,
    outputHashes: status.stages[stage].outputs,
    model,
    recordedAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath(applicationDir), JSON.stringify(manifest, null, 2) + "\n");
  return manifest.stages[stage];
}
