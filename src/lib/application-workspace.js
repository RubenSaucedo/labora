import fs from "node:fs";
import path from "node:path";
import { personaPath, readJson, sha256 } from "./persona-files.js";

const CONTRACT_FILE = "application-workspace.json";
const INDEX_FORMAT = "labora-application-index-v1";
const DASHBOARD_MARKER = "<!-- labora:application-dashboard -->";

export function readApplicationWorkspace(root) {
  const file = personaPath(root, CONTRACT_FILE);
  if (!fs.existsSync(file)) return { layout: "native", instructions: null };
  const contract = readJson(file);
  if (contract.schemaVersion !== "1.0" || contract.layout !== "shared-current-state" ||
      contract.indexFormat !== INDEX_FORMAT) {
    throw new Error("Unrecognized application workspace contract; ask the operator to declare its layout and index format.");
  }
  const paths = {};
  for (const key of ["instructions", "index", "briefs", "forms", "answers", "plans", "dashboard"]) {
    paths[key] = personaPath(root, contract[key]);
  }
  if (new Set(Object.values(paths)).size !== Object.keys(paths).length || Object.values(paths).includes(file)) {
    throw new Error("Workspace output paths must be distinct from one another and the authored instructions.");
  }
  if (!fs.existsSync(paths.instructions)) {
    throw new Error("The authored workspace instructions are missing; restore their declared path before choosing outputs.");
  }
  return { layout: contract.layout, contract, paths, instructions: fs.readFileSync(paths.instructions, "utf8") };
}

export function readApplicationIndex(workspace) {
  if (workspace.layout !== "shared-current-state") {
    throw new Error("Declare application-workspace.json before using a shared index; native packages remain available by explicit path.");
  }
  if (!fs.existsSync(workspace.paths.index)) return { schemaVersion: "1.0", openings: [] };
  const index = readJson(workspace.paths.index);
  if (index.schemaVersion !== "1.0" || !Array.isArray(index.openings)) {
    throw new Error("Unrecognized index format; keep the existing index intact and agree an explicit adapter or conversion with its owner.");
  }
  return index;
}

export function resolveObservation(root, source) {
  const file = personaPath(root, source?.path);
  if (!fs.existsSync(file)) {
    throw new Error("Dangling observation reference; update its declared persona-relative path, including an explicit archive path if moved.");
  }
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== source.sha256) {
    throw new Error("Observation hash mismatch; recover the referenced bytes or explicitly select a new observation.");
  }
  const data = JSON.parse(bytes);
  const matches = (data.candidates ?? data.jobs ?? []).filter((job) => job.jobId === source.jobId);
  if (matches.length !== 1) throw new Error("The observation must contain exactly one selected jobId; correct the source reference.");
  const job = matches[0];
  if (!source.observedAt || source.observedAt !== job.observedAt || !source.postingHash ||
      source.postingHash !== job.postingHash) {
    throw new Error("Observation timestamp or posting hash differs; preserve the original observation metadata.");
  }
  return job;
}

function identityKey(identity) {
  if (identity?.authority?.trim() && identity?.requisition?.trim()) {
    return JSON.stringify(["requisition", identity.authority.trim().toLowerCase(), identity.requisition.trim()]);
  }
  if (identity?.url) {
    const url = new URL(identity.url);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Opening identity needs an HTTP(S) posting URL.");
    url.hash = "";
    url.searchParams.sort();
    return JSON.stringify(["url", url.href]);
  }
  throw new Error("Ambiguous opening identity; supply an authority and requisition or an exact canonical URL, never a title alone.");
}

function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function briefText(entry) {
  return `<!-- labora:opening ${entry.openingId} -->\n# ${entry.title}\n\n` +
    `Posting: ${entry.url}\n\nObservation: ${entry.source.observedAt} (historical source)\n` +
    `Source: ${entry.source.path}\nSource SHA-256: ${entry.source.sha256}\n` +
    `Posting SHA-256: ${entry.source.postingHash}\n\n` +
    `Posting verification: ${entry.verification.status}\n` +
    `Form capture: ${entry.formCapture.status}\nAnswer review: ${entry.answerReview.status}\n` +
    `Submission: ${entry.submission.status}\n\nThe shared index/dashboard is the operational record. ` +
    `A discovery observation or seen.json entry does not establish that the posting is open now.\n`;
}

export function dashboardText(index) {
  const rows = index.openings.map((entry) =>
    `| ${cell(entry.openingId)} | ${cell(entry.title)} | ${cell(entry.verification?.status ?? "historical")} | ` +
    `${cell(entry.formCapture?.status ?? "not_captured")} | ${cell(entry.answerReview?.status ?? "not_reviewed")} | ` +
    `${cell(entry.submission?.status ?? "unknown")} |`);
  return `${DASHBOARD_MARKER}\n# Current applications\n\n` +
    `| Opening | Title | Posting verification | Form capture | Answer review | Submission |\n` +
    `| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\n` +
    `Observation dates are historical until explicitly re-verified. Unknown submission state is not submitted.\n`;
}

function assertProducedOutput(file, marker) {
  if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").startsWith(marker)) {
    throw new Error("An output is operator-owned; choose an unused declared path instead of overwriting it.");
  }
}

function writeOutput(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function trackOpening(root, selection, { apply = false } = {}) {
  const workspace = readApplicationWorkspace(root);
  // Read the instructions before interpreting any existing index or choosing outputs.
  const index = readApplicationIndex(workspace);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selection.openingId ?? "")) {
    throw new Error("Supply a stable kebab-case openingId.");
  }
  const key = identityKey(selection.identity);
  const matches = index.openings.filter((entry) => identityKey(entry.identity) === key);
  if (matches.length > 1) throw new Error("Ambiguous duplicate identities in the index; ask its owner to reconcile them.");
  const byId = index.openings.find((entry) => entry.openingId === selection.openingId);
  if (byId && identityKey(byId.identity) !== key) {
    throw new Error("This openingId already denotes a different identity; use a distinct requisition ID.");
  }
  const previous = matches[0];
  const openingId = previous?.openingId ?? selection.openingId;
  const observed = resolveObservation(root, selection.source);
  let verification = previous?.verification;
  if (!previous || previous.source.sha256 !== selection.source.sha256 ||
      previous.source.jobId !== selection.source.jobId) {
    verification = { status: "historical", observedAt: observed.observedAt };
  }
  if (selection.verification) {
    const { status, checkedAt, url } = selection.verification;
    if (!["open", "closed", "unknown"].includes(status) || !Number.isFinite(Date.parse(checkedAt)) || !url) {
      throw new Error("Explicit posting verification needs status, checkedAt and the checked URL.");
    }
    verification = { status, checkedAt, url };
  }
  const entry = {
    ...previous, openingId, identity: selection.identity, title: observed.title,
    company: observed.company, url: observed.officialUrl || observed.url,
    source: { ...selection.source }, verification,
    formCapture: previous?.formCapture ?? { status: "not_captured" },
    answerReview: previous?.answerReview ?? { status: "not_reviewed" },
    submission: previous?.submission ?? { status: "unknown" },
    brief: `${workspace.contract.briefs}/${openingId}.md`,
  };
  const next = { ...index, openings: [...index.openings.filter((item) => item !== previous), entry]
    .sort((a, b) => a.openingId.localeCompare(b.openingId)) };
  const brief = personaPath(root, entry.brief);
  assertProducedOutput(brief, `<!-- labora:opening ${openingId} -->`);
  assertProducedOutput(workspace.paths.dashboard, DASHBOARD_MARKER);
  if (apply) {
    fs.mkdirSync(path.dirname(workspace.paths.index), { recursive: true });
    const lock = `${workspace.paths.index}.lock`;
    const handle = fs.openSync(lock, "wx");
    try {
      const current = readApplicationIndex(workspace);
      if (JSON.stringify(current) !== JSON.stringify(index)) {
        throw new Error("The index changed during preparation; inspect it and retry the handoff.");
      }
      writeOutput(brief, briefText(entry));
      writeOutput(workspace.paths.dashboard, dashboardText(next));
      writeOutput(workspace.paths.index, `${JSON.stringify(next, null, 2)}\n`);
    } finally {
      fs.closeSync(handle);
      fs.unlinkSync(lock);
    }
  }
  return { applied: apply, entry, index: next, instructions: workspace.instructions };
}
