// career-issue.js — shape, provenance allowlist and disclosure scan for issues
// filed on a repository the persona owns.
//
// This module imports nothing but Node builtins, deliberately. Its job is to
// *withhold* publication, and a gate that only runs where dependencies install
// is absent on exactly the machines where it matters most — locked-down
// laptops, fresh checkouts, someone else's shell. Validation here is hand-rolled
// for that reason, not because a schema library was unavailable.
import fs from "node:fs";
import path from "node:path";

// The four kinds differ in what closing them actually buys, so they are not
// interchangeable labels on one template. `polish` buys a signal of care;
// `legibility` converts work that already exists but cannot be read into
// attestable evidence; `gap` and `growth` describe work that is not yet true.
export const KIND_SHAPES = {
  polish: {
    heading: "What's broken",
    notYetTrue: false,
    buys: "A signal of care on a surface a reader actually opens.",
  },
  legibility: {
    heading: "What can't be read",
    notYetTrue: false,
    buys: "Turns work that already exists into work a stranger can assess.",
  },
  gap: {
    heading: "What's missing",
    notYetTrue: true,
    buys: "New verifiable work.",
  },
  growth: {
    heading: "What this would stretch",
    notYetTrue: true,
    buys: "A deliberate, dated direction.",
  },
};

export const CAREER_ISSUE_KINDS = Object.keys(KIND_SHAPES);

// The provenance trailer is an allowlist, not a redaction pass. A redaction
// pass has to recognise every shape of identifying detail to be safe; an
// allowlist only has to recognise the few that are.
//
// `application` is deliberately absent. An application slug encodes the target
// employer and the posting title, which is exactly what must not appear on a
// public repository — so the trailer carries the requirement that motivated the
// work, never the opening that surfaced it.
export const PROVENANCE_FIELDS = ["claimIds", "requirementId", "gapStatus"];

// Job-search context that identifies the *reason* an issue was filed. A repo
// issue is a legitimate engineering request or it is nothing; if it only makes
// sense as job-search collateral, it is the wrong issue.
export const JOB_SEARCH_TERMS = [
  "recruiter",
  "hiring manager",
  "job posting",
  "job description",
  "job application",
  "salary",
  "offer letter",
  "rejection email",
  "applicant tracking",
  "interview loop",
  "onsite interview",
];

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const readJsonIf = (file) => {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
};

export function normalizeDraft(input) {
  const errors = [];
  const text = (key) => String(input?.[key] ?? "").trim();

  const kind = text("kind");
  if (!CAREER_ISSUE_KINDS.includes(kind)) {
    errors.push(`kind must be one of ${CAREER_ISSUE_KINDS.join(", ")}`);
  }

  const repo = text("repo");
  if (!REPO_PATTERN.test(repo)) errors.push("repo must be owner/repo");

  for (const field of ["title", "problem", "route", "doneWhen"]) {
    if (!text(field)) errors.push(`${field} is required`);
  }

  const provenanceInput = input?.provenance || {};
  for (const key of Object.keys(provenanceInput)) {
    if (!PROVENANCE_FIELDS.includes(key)) {
      errors.push(`provenance.${key} is not an allowlisted field`);
    }
  }
  const claimIds = (provenanceInput.claimIds || []).map((id) => String(id).trim()).filter(Boolean);
  for (const id of claimIds) {
    if (!ID_PATTERN.test(id)) errors.push(`claim id "${id}" is not an identifier`);
  }
  const requirementId = String(provenanceInput.requirementId || "").trim();
  if (requirementId && !ID_PATTERN.test(requirementId)) {
    errors.push(`requirement id "${requirementId}" is not an identifier`);
  }
  const gapStatus = String(provenanceInput.gapStatus || "").trim();
  if (gapStatus && !/^[a-z_]+$/.test(gapStatus)) {
    errors.push(`gap status "${gapStatus}" is not a status`);
  }

  const draftedAt = text("draftedAt") || new Date().toISOString();
  if (Number.isNaN(Date.parse(draftedAt))) errors.push("draftedAt must be an ISO timestamp");

  if (errors.length) throw new Error(errors.join("; "));

  return {
    schemaVersion: "1.0",
    kind,
    repo,
    title: text("title"),
    problem: text("problem"),
    route: text("route"),
    doneWhen: text("doneWhen"),
    whyItMatters: text("whyItMatters"),
    provenance: { claimIds, requirementId, gapStatus },
    draftedAt,
    // Terms the operator inspected and judged to be about a technology rather
    // than about employment. Recorded so the decision stays auditable instead
    // of invisible.
    acknowledgedTerms: (input?.acknowledgedTerms || []).map((term) => String(term)),
  };
}

/**
 * Terms that must not reach a public repository, derived from the workspace
 * rather than guessed. Employers and target companies are read from the
 * persona's own files, because a hard-coded list would be wrong for everyone.
 */
export function collectForbiddenTerms(personaRoot) {
  const terms = new Set(JOB_SEARCH_TERMS);

  const identity = readJsonIf(path.join(personaRoot, "profile/generated/identity.json")) || {};
  for (const experience of identity.experience || identity.experiences || []) {
    if (experience?.company) terms.add(String(experience.company));
  }
  for (const part of String(identity.contact?.name || "").split(/\s+/)) {
    if (part.length >= 3) terms.add(part);
  }

  const applicationsDir = path.join(personaRoot, "applications");
  let slugs = [];
  try {
    slugs = fs
      .readdirSync(applicationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    slugs = [];
  }
  for (const slug of slugs) {
    terms.add(slug);
    const spec = readJsonIf(path.join(applicationsDir, slug, "job-spec.json"));
    if (spec?.company) terms.add(String(spec.company));
  }

  return [...terms].map((term) => term.trim()).filter((term) => term.length >= 3).sort();
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Findings, not a verdict. A match may be a genuine leak or a technology that
 * happens to share a name with an employer, and the tool cannot tell those
 * apart — so it names the term and hands the decision to a human.
 */
export function disclosureFindings(text, forbiddenTerms, acknowledged = []) {
  const excused = new Set(acknowledged.map((term) => term.toLowerCase()));
  const findings = [];
  for (const term of forbiddenTerms) {
    if (excused.has(term.toLowerCase())) continue;
    const lead = /^[A-Za-z0-9]/.test(term) ? "\\b" : "";
    const tail = /[A-Za-z0-9]$/.test(term) ? "\\b" : "";
    const match = new RegExp(`${lead}${escapeRegExp(term)}${tail}`, "i").exec(text);
    if (match) findings.push({ term, at: match.index });
  }
  return findings;
}

/**
 * The trailer is machine-readable so a later stage can find the issue, and
 * carries only allowlisted identifiers. It is an HTML comment because a reader
 * of the repository should see an engineering issue, not bookkeeping.
 */
export function renderProvenanceTrailer(draft) {
  const parts = [`kind=${draft.kind}`];
  if (draft.provenance.claimIds.length) parts.push(`claims=${draft.provenance.claimIds.join(",")}`);
  if (draft.provenance.requirementId) parts.push(`requirement=${draft.provenance.requirementId}`);
  if (draft.provenance.gapStatus) parts.push(`gap-status=${draft.provenance.gapStatus}`);
  parts.push(`drafted=${draft.draftedAt.slice(0, 10)}`);
  return `<!-- labora:career-issue ${parts.join(" ")} -->`;
}

const section = (heading, body) => `## ${heading}\n\n${String(body).trim()}\n`;

export function renderCareerIssue(input) {
  const draft = normalizeDraft(input);
  const shape = KIND_SHAPES[draft.kind];

  const blocks = [section(shape.heading, draft.problem)];
  if (shape.notYetTrue) {
    blocks.push(
      "> This describes work that has not been done yet. Nothing here is a\n" +
        "> record of completed work until the issue is closed by a change.\n"
    );
  }
  blocks.push(section("Route", draft.route));
  blocks.push(section("Done when", draft.doneWhen));
  if (draft.whyItMatters) blocks.push(section("Why it matters", draft.whyItMatters));
  blocks.push(renderProvenanceTrailer(draft) + "\n");

  return blocks.join("\n");
}

export function slugifyTitle(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "issue"
  );
}

// Single-quote for POSIX shells. The command is printed for a human to run, so
// it has to survive text that arrived from a job posting or a model.
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function fileCommand(draft, bodyPath) {
  return [
    "gh issue create",
    `--repo ${shellQuote(draft.repo)}`,
    `--title ${shellQuote(draft.title)}`,
    `--body-file ${shellQuote(bodyPath)}`,
  ].join(" ");
}
