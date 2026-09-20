import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertSafeDocument } from "./file-safety.js";
import { configuredModelLabel, defaultSettingsPath, judgeModelReport } from "./copilot-settings.js";
import { loadJobFromFile } from "./job-parser.js";
import { pluginRoot as PLUGIN_ROOT } from "./paths.js";
import { pluginAgentPath, pluginAgentPromptLabel } from "./plugin-components.js";
import { extractTextFromDocx } from "../utils/docx-to-text.js";
import { extractTextFromPdf } from "../utils/pdf-to-md.js";

const JUDGES = new Set(["ats", "engineer", "hr"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileHash(filePath) {
  return sha256(fs.readFileSync(filePath));
}

async function artifactText(artifactPath) {
  const extension = path.extname(artifactPath).toLowerCase();
  if (extension === ".docx") {
    return extractTextFromDocx({ path: assertSafeDocument(artifactPath, "docx") });
  }
  if (extension === ".pdf") {
    const safePath = assertSafeDocument(artifactPath, "pdf");
    const result = await extractTextFromPdf(fs.readFileSync(safePath));
    return result.text || "";
  }
  throw new Error("Judge artifact must be DOCX or PDF.");
}

function computePromptHash(pluginRoot, judge) {
  const promptFiles = [
    path.join(pluginRoot, "skills", "resume-conventions", "SKILL.md"),
    pluginAgentPath(pluginRoot, `judge-${judge}`),
    path.join(pluginRoot, "skills", `judge-${judge}`, "SKILL.md"),
  ];
  const parts = promptFiles.map((filePath) => {
    const relativePath = filePath.endsWith(".agent.md")
      ? pluginAgentPromptLabel(filePath)
      : path.relative(pluginRoot, filePath);
    return `${relativePath}:${fileHash(filePath)}`;
  });
  return sha256(parts.join("\n"));
}

function readAtsResults(applicationDir) {
  const atsPath = path.join(applicationDir, "ats-results.json");
  if (!fs.existsSync(atsPath)) {
    throw new Error("ATS judge input requires applications/<slug>/ats-results.json.");
  }
  const raw = JSON.parse(fs.readFileSync(atsPath, "utf8"));
  return raw?.best?.ats || raw?.ats || raw;
}

function visualPreview(applicationDir, expectedArtifactHash) {
  const previewDir = path.join(applicationDir, "previews");
  const manifestPath = path.join(previewDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { status: "missing", paths: [], manifestHash: null };
  }
  const manifestRaw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);
  if (
    manifest?.schemaVersion !== "1.0" ||
    manifest?.sourceArtifactHash !== expectedArtifactHash ||
    !Number.isInteger(manifest?.pageCount) ||
    !Array.isArray(manifest?.pages) ||
    manifest.pages.length !== manifest.pageCount
  ) {
    return {
      status: manifest?.sourceArtifactHash === expectedArtifactHash
        ? "invalid_manifest"
        : "artifact_mismatch",
      paths: [],
      manifestHash: sha256(manifestRaw),
    };
  }
  const paths = [];
  for (const page of manifest.pages) {
    if (
      !/^page-\d+\.png$/.test(page?.file || "") ||
      !/^[a-f0-9]{64}$/i.test(page?.hash || "")
    ) {
      return { status: "invalid_manifest", paths: [], manifestHash: sha256(manifestRaw) };
    }
    const pagePath = path.join(previewDir, page.file);
    if (!fs.existsSync(pagePath) || fileHash(pagePath) !== page.hash) {
      return { status: "page_hash_mismatch", paths: [], manifestHash: sha256(manifestRaw) };
    }
    paths.push(pagePath);
  }
  return {
    status: "verified",
    paths,
    manifestHash: sha256(manifestRaw),
  };
}

export async function prepareJudgeInput({
  pluginRoot = PLUGIN_ROOT,
  applicationDir,
  artifactPath,
  judge,
}) {
  const expected = await expectedJudgeMetadata({
    pluginRoot,
    applicationDir,
    artifactPath,
    judge,
  });
  const resolvedArtifact = path.resolve(artifactPath);

  return {
    schemaVersion: "1.0",
    metadata: expected.metadata,
    judge,
    job: expected.job,
    artifact: {
      name: path.basename(resolvedArtifact),
      type: path.extname(resolvedArtifact).slice(1).toLowerCase(),
      text: expected.artifactText,
    },
    deterministicAts: expected.deterministicAts,
    visualPreview: expected.visualPreview,
    visualPreviewPaths: expected.visualPreviewPaths,
  };
}

export async function expectedJudgeMetadata({
  pluginRoot = PLUGIN_ROOT,
  applicationDir,
  artifactPath,
  judge,
  settingsPath = defaultSettingsPath(),
}) {
  if (!JUDGES.has(judge)) throw new Error(`Unknown judge "${judge}".`);

  const resolvedApplication = path.resolve(applicationDir);
  const resolvedArtifact = path.resolve(artifactPath);
  const job = loadJobFromFile(path.join(resolvedApplication, "job.md"));
  const evaluatedArtifactHash = fileHash(resolvedArtifact);
  const extractedArtifactText = await artifactText(resolvedArtifact);
  const deterministicAts = judge === "ats" ? readAtsResults(resolvedApplication) : null;
  const parsedJob = {
    title: job.title,
    company: job.company,
    description: job.description,
  };
  const preview = judge === "hr"
    ? visualPreview(resolvedApplication, evaluatedArtifactHash)
    : { status: "not_applicable", paths: [], manifestHash: null };
  const metadata = {
    // Read from the runtime's configuration, never from the judge. A judge
    // cannot see its own model and will invent a plausible name when asked, so
    // this field is supplied here and compared by the quality gate exactly like
    // the hashes beside it.
    model: configuredModelLabel(judgeModelReport({ settingsPath }), `judge-${judge}`),
    evaluatedArtifactHash,
    promptHash: computePromptHash(pluginRoot, judge),
    inputHash: sha256(JSON.stringify({
      judge,
      job: parsedJob,
      artifactHash: evaluatedArtifactHash,
      artifactTextHash: sha256(extractedArtifactText),
      deterministicAts,
      visualPreviewStatus: preview.status,
      visualPreviewManifestHash: preview.manifestHash,
      visualPreviewHashes: preview.paths.map((previewPath) => fileHash(previewPath)),
    })),
  };

  return {
    metadata,
    job: parsedJob,
    deterministicAts,
    artifactText: extractedArtifactText,
    visualPreview: {
      status: preview.status,
      pageCount: preview.paths.length,
    },
    visualPreviewPaths: preview.paths,
  };
}
