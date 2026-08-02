import { SECTION_DEFS } from "./job-sections.js";
import {
  SKILL_ALIAS_VERSION,
  canonicalSkillsInText,
} from "./skill-aliases.js";

const REQUIREMENT_STOPWORDS = new Set([
  "about", "ability", "all", "also", "and", "are", "basic", "candidate",
  "communication", "company", "excellent", "experience", "familiarity", "for",
  "from", "have", "ideal", "including", "industry", "job", "knowledge", "minimum",
  "must", "need", "our", "preferred", "qualifications", "required", "requirements",
  "responsibilities", "role", "skills", "strong", "successful", "team", "that",
  "the", "this", "understanding", "with", "work", "working", "years", "you", "your",
]);

function normalizeHeading(line) {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
}

function sectionForHeading(line) {
  const heading = normalizeHeading(line);
  const matches = SECTION_DEFS.flatMap((definition) =>
    definition.cues
      .filter((cue) => heading === cue || heading.includes(cue))
      .map((cue) => ({
        label: definition.label,
        exact: heading === cue,
        cueLength: cue.length,
      }))
  ).sort((a, b) => Number(b.exact) - Number(a.exact) || b.cueLength - a.cueLength);
  return matches[0]?.label;
}

function isHeading(line) {
  const trimmed = line.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  if (/^[A-Z][A-Za-z &/()-]{2,60}:$/.test(trimmed)) return true;
  if (/^[-*•]\s+/.test(trimmed) || !sectionForHeading(trimmed)) return false;

  const heading = normalizeHeading(trimmed);
  const isExactCue = SECTION_DEFS.some((definition) => definition.cues.includes(heading));
  const isConventionalHeading = heading.split(/\s+/).length <= 6 &&
    /\b(?:qualifications|requirements|responsibilities|skills|duties|overview)\b$/.test(heading);
  if (isExactCue || isConventionalHeading) return true;
  return false;
}

function cleanRequirementText(line) {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function requirementPriority(section) {
  if (section === "requirements") return "required";
  if (section === "nice_to_have") return "preferred";
  return "responsibility";
}

function sponsorshipAvailable(text) {
  return (
    /\b(?:visa )?sponsorship (?:is )?(?:available|provided|offered)\b/i.test(text) ||
    /\b(?:we|company|employer) (?:can|will) sponsor\b/i.test(text)
  );
}

function isAuthorizationRequirement(text) {
  return (
    !sponsorshipAvailable(text) &&
    /\b(?:must be authorized|authorized to work|work authorization required|without (?:visa )?sponsorship|no (?:visa )?sponsorship|cannot sponsor|unable to sponsor|citizen|citizenship)\b/i.test(text)
  );
}

function isClearanceRequirement(text) {
  return /\b(?:security clearance|clearance required|active clearance|secret clearance|top secret|ts[\s/.-]*sci|sci clearance|public trust)\b/i
    .test(text);
}

function isProfessionalLicenseRequirement(text) {
  if (
    /\b(?:software|open[- ]source) licenses?\b/i.test(text) ||
    /\b(?:license|licensing) compliance\b/i.test(text) ||
    /\bsoftware asset\b/i
      .test(text)
  ) {
    return false;
  }
  const namedCredentialLicense =
    /\b(?:Active|Current|Valid)\s+[A-Z][A-Z0-9./-]{1,15}\s+(?:license|licensure)\b/.test(text) ||
    /\b[A-Z][A-Z0-9./-]{1,15}\s+(?:license|licensure) required\b/.test(text);
  return (
    namedCredentialLicense ||
    /\b(?:medical|professional|clinical|nursing|engineering|teaching|pharmacy|driver'?s?|state-issued) (?:license|licensure)\b/i.test(text) ||
    /\blicensed (?:engineer|physician|doctor|nurse|attorney|lawyer|pharmacist|clinician|teacher)\b/i.test(text) ||
    /\b(?:bar admission|certification required)\b/i.test(text)
  );
}

function classifyRequirement(text, priority) {
  if (/\b\d+\+?\s*(?:-|to)?\s*\d*\s*years?\b/i.test(text)) return "years";
  if (/\b(?:bachelor|master|phd|degree|b\.?s\.?|m\.?s\.?)\b/i.test(text)) return "degree";
  if (isAuthorizationRequirement(text)) return "authorization";
  if (isClearanceRequirement(text)) return "clearance";
  if (isProfessionalLicenseRequirement(text)) return "license";
  if (canonicalSkillsInText(text).length) return "skill";
  if (priority === "responsibility") return "responsibility";
  return "other";
}

function requirementSeverity(text, priority, kind) {
  if (sponsorshipAvailable(text)) {
    return "soft_signal";
  }
  if (priority === "preferred") return "preferred";
  if (priority === "responsibility") return "soft_signal";
  if (["authorization", "clearance", "license"].includes(kind)) return "hard_eligibility";
  if (
    /\b(?:communication|communicate|collaboration|collaborate|interpersonal|team player|mentoring)\b/i
      .test(text)
  ) {
    return "soft_signal";
  }
  return "core";
}

function extractMinimumYears(text) {
  const match = text.match(/\b(\d+)\+?\s*(?:-|to)?\s*\d*\s*years?\b/i);
  return match ? Number(match[1]) : null;
}

export function significantRequirementTokens(text) {
  return cleanRequirementText(text)
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((token) =>
      token.length >= 3 &&
      !REQUIREMENT_STOPWORDS.has(token) &&
      !/^\d+$/.test(token)
    );
}

export function extractJobRequirements({ title = "", company = "", description = "", sourcePath = "" }) {
  const requirements = [];
  let section = "about";

  description.split(/\r?\n/).forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    if (isHeading(trimmed)) {
      section = sectionForHeading(trimmed) || section;
      return;
    }

    const text = cleanRequirementText(trimmed);
    const isBullet = /^[-*•]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed);
    if (!isBullet && !["requirements", "nice_to_have", "responsibilities"].includes(section)) {
      return;
    }
    if (text.length < 4) return;

    const priority = requirementPriority(section);
    const canonicalMatches = canonicalSkillsInText(text);
    const canonicalTerms = canonicalMatches.map((match) => match.canonicalId);
    const surfaceForms = canonicalMatches.map((match) => match.matchedSurface);
    const matchMode = canonicalTerms.length > 1
      ? (/\bor\b/i.test(text) ? "any" : "all")
      : "threshold";

    const primaryKind = classifyRequirement(text, priority);
    const kinds = [primaryKind];
    for (const [kind, detected] of [
      ["authorization", isAuthorizationRequirement(text)],
      ["clearance", isClearanceRequirement(text)],
      ["license", isProfessionalLicenseRequirement(text)],
    ]) {
      if (detected && !kinds.includes(kind)) kinds.push(kind);
    }
    for (const kind of kinds) {
      const usesSkills = ["years", "skill", "responsibility", "other"].includes(kind);
      requirements.push({
        id: `req-${String(requirements.length + 1).padStart(3, "0")}`,
        kind,
        priority,
        severity: requirementSeverity(text, priority, kind),
        text,
        sourceLine: index + 1,
        canonicalTerms: usesSkills ? canonicalTerms : [],
        surfaceForms: usesSkills ? surfaceForms : [],
        matchMode: usesSkills ? matchMode : "threshold",
        minimumYears: kind === "years" ? extractMinimumYears(text) : null,
      });
    }
  });

  return {
    schemaVersion: "1.0",
    title,
    company,
    sourcePath,
    aliasVersion: SKILL_ALIAS_VERSION,
    requirements,
  };
}
