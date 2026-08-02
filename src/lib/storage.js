import fs from "fs";
import path from "path";

// v2 layout (Option A):
//   data/personas/<name>/
//     profile/                    human-authored sources
//       contact.md                private contact card; never grounds claims
//       background.md             durable self-reported facts; grounds claims
//       career.md                 period-by-period narrative; grounds claims
//       search-preferences.json   trusted job-search config
//       generated/                written only by resume-persona; read by everyone
//         identity.json           structural spine
//         claims.json             verified claim ledger
//         accomplishments.json    retrieval index over the ledger
//     evidence/... (personal history; gitignored)
//     applications/<job-slug>/{job.md, resume.json, ..., judges/*.json}
const DATA_DIR = path.join(process.cwd(), "data");
const PERSONAS_DIR = path.join(DATA_DIR, "personas");

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
  return path.join(PERSONAS_DIR, clean(name));
}
export function getPersonaDir(name) {
  const dir = personaRootPath(name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- profile ----
// Human-authored sources live at the profile root; everything resume-persona
// produces lives under profile/generated/ so the ownership boundary is visible
// in the filesystem rather than only in documentation.
export function getProfileDir(name) {
  const dir = path.join(personaRootPath(name), "profile");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export function getGeneratedDir(name) {
  const dir = path.join(personaRootPath(name), "profile", "generated");
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
  return path.join(personaRootPath(name), "profile", "generated", "identity.json");
}
export function getClaimsPath(name) {
  return path.join(personaRootPath(name), "profile", "generated", "claims.json");
}
export function getAccomplishmentsPath(name) {
  return path.join(personaRootPath(name), "profile", "generated", "accomplishments.json");
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
// Generated artifacts sit at <persona>/profile/generated/<file>, while older
// layouts kept them at <persona>/profile/<file>. Walk up to the persona root
// instead of hardcoding a depth, so callers work under either layout.
export function personaRootFromProfileFile(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  for (let hops = 0; hops < 4; hops += 1) {
    if (path.basename(dir) === "profile") return path.dirname(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(path.dirname(path.resolve(filePath)));
}
