import fs from "fs";
import path from "path";
import { resolvePersonaRoot } from "./workspace.js";
import { personaRootFromStateFile, profileStateDir, profileStatePath } from "./profile-state.js";

// v2 layout (Option A). The persona container is resolved by workspace.js and
// normally lives OUTSIDE this repo in a private workspace (see labora.json /
// $LABORA_WORKSPACE); the in-repo `data/personas/` path remains as a legacy
// fallback and as the home of the committed `example` fixture.
//   <workspace>/personas/<name>/
//     profile/                    human-authored sources
//       contact.md                private contact card; never grounds claims
//       background.md             durable self-reported facts; grounds claims
//       career.md                 period-by-period narrative; grounds claims
//       search-preferences.json   trusted job-search config
//       generated/                written only by resume-persona; read by everyone
//         identity.json           structural spine
//         claims.json             verified claim ledger
//         accomplishments.json    retrieval index over the ledger
//     evidence/... (personal history; never committed)
//     applications/<job-slug>/{job.md, resume.json, ..., judges/*.json}

function clean(name) {
  const base = (name || "").replace(/\.(md|json)$/i, "").trim();
  if (!base) throw new Error("persona name is required");
  return base;
}

export function toJobSlug(jobArg) {
  if (!jobArg || typeof jobArg !== "string") return "";
  return jobArg.replace(/\.md$/i, "").trim();
}

// ---- persona root ----
export function personaRootPath(name) {
  return resolvePersonaRoot(clean(name));
}
export function getPersonaDir(name) {
  const dir = personaRootPath(name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- profile ----
// Human-authored sources live at the profile root. Compiled ledgers are machine
// state and live wherever profile-state.js resolves them: `.labora/state/profile/`
// for a new persona, `profile/generated/` for one that already has state there.
export function getProfileDir(name) {
  const dir = path.join(personaRootPath(name), "profile");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export function getGeneratedDir(name) {
  const dir = profileStateDir(personaRootPath(name));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export function getSearchPreferencesPath(name) {
  return path.join(personaRootPath(name), "profile", "search-preferences.json");
}
export function getCareerPath(name) {
  return path.join(personaRootPath(name), "profile", "career.md");
}
export function getContactPath(name) {
  return path.join(personaRootPath(name), "profile", "contact.md");
}
export function getBackgroundPath(name) {
  return path.join(personaRootPath(name), "profile", "background.md");
}
export function getIdentityPath(name) {
  return profileStatePath(personaRootPath(name), "identity.json");
}
export function getClaimsPath(name) {
  return profileStatePath(personaRootPath(name), "claims.json");
}
export function getAccomplishmentsPath(name) {
  return profileStatePath(personaRootPath(name), "accomplishments.json");
}

// ---- applications (one dir per job: JD + outputs together) ----
export function applicationDirPath(name, jobSlug) {
  return path.join(personaRootPath(name), "applications", toJobSlug(jobSlug));
}
export function getApplicationDir(name, jobSlug) {
  const dir = applicationDirPath(name, jobSlug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getJobFilePath(name, jobSlug) {
  return path.join(applicationDirPath(name, jobSlug), "job.md");
}
export function getJobResumePath(name, jobSlug) {
  return path.join(applicationDirPath(name, jobSlug), "resume.json");
}
export function getJobSpecPath(name, jobSlug) {
  return path.join(applicationDirPath(name, jobSlug), "job-spec.json");
}
export function getAtsResultsPath(name, jobSlug) {
  return path.join(applicationDirPath(name, jobSlug), "ats-results.json");
}
export function getValidationPath(name, jobSlug, kind) {
  return path.join(applicationDirPath(name, jobSlug), "validations", `${kind}.json`);
}
export function getReleasePath(name, jobSlug) {
  return path.join(applicationDirPath(name, jobSlug), "release.json");
}
export function getRunManifestPath(name, jobSlug) {
  return path.join(applicationDirPath(name, jobSlug), "run.json");
}
function getJudgesDir(name, jobSlug) {
  const dir = path.join(getApplicationDir(name, jobSlug), "judges");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- writers ----
export function saveJobResume(name, jobSlug, resume) {
  const file = path.join(getApplicationDir(name, jobSlug), "resume.json");
  fs.writeFileSync(file, JSON.stringify(resume, null, 2), "utf-8");
  return file;
}
export function saveAtsResultsApplicant(name, jobSlug, payload) {
  const file = path.join(getApplicationDir(name, jobSlug), "ats-results.json");
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  return file;
}
export function saveAtsJudgeApplicant(name, jobSlug, payload) {
  const file = path.join(getJudgesDir(name, jobSlug), "ats.json");
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  return file;
}
export function saveEngineerJudgeApplicant(name, jobSlug, payload) {
  const file = path.join(getJudgesDir(name, jobSlug), "engineer.json");
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  return file;
}
export function saveHrJudgeFeedbackApplicant(name, jobSlug, feedback) {
  const file = path.join(getJudgesDir(name, jobSlug), "hr.json");
  fs.writeFileSync(file, JSON.stringify(feedback, null, 2), "utf-8");
  return file;
}
export function saveFinalDocxApplicant(name, jobSlug, buffer, style) {
  const dir = getApplicationDir(name, jobSlug);
  const suffix = [1, 2, 3, 4].includes(style) ? `-style-${style}` : "";
  const file = path.join(dir, `final-resume${suffix}.docx`);
  fs.writeFileSync(file, buffer);
  return file;
}
export function saveFinalPdfApplicant(name, jobSlug, buffer, style) {
  const dir = getApplicationDir(name, jobSlug);
  const suffix = [1, 2, 3, 4].includes(style) ? `-style-${style}` : "";
  const file = path.join(dir, `final-resume${suffix}.pdf`);
  fs.writeFileSync(file, buffer);
  return file;
}
export function saveSummaryApplicant(name, jobSlug, markdown) {
  const file = path.join(getApplicationDir(name, jobSlug), "summary.md");
  fs.writeFileSync(file, markdown, "utf-8");
  return file;
}

// ---- path introspection ----
// A compiled ledger may sit at <persona>/.labora/state/profile/<file> (current)
// or <persona>/profile/generated/<file> (legacy, and older layouts kept it at
// <persona>/profile/<file>). All three must resolve to the same persona root.
export function personaRootFromProfileFile(filePath) {
  return personaRootFromStateFile(filePath);
}
