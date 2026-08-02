import { ZIdentity } from "../schemas/identity.js";

/**
 * Reads an identity document of either schema version and returns a 4.0 value.
 *
 * 3.0 carried three things 4.0 deliberately drops: `summary` and
 * `key_achievements` (a pre-baked generic resume that anchored the tailor) and
 * `experience[].highlights` (bullets that belong to the claim ledger). They are
 * discarded rather than migrated, because carrying them forward would preserve
 * the exact problem 4.0 exists to remove.
 *
 * `technical_skills` is preserved as `legacy_skills` so a persona that predates
 * the accomplishment bank still has a displayable vocabulary.
 */
export function normalizeIdentity(raw) {
  // Version detection is by shape, not just the field: early identity documents were
  // written without a schema_version, and routing those to the 4.0 branch fails
  // on keys 4.0 deliberately removed.
  const legacyFields = ["summary", "technical_skills", "key_achievements"];
  const looksLegacy = legacyFields.some((field) => raw?.[field] !== undefined)
    || (raw?.experience || []).some((entry) => entry?.highlights !== undefined);
  const version = raw?.schema_version ?? (looksLegacy ? "3.0" : "4.0");

  if (version === "4.0") return ZIdentity.parse(raw);
  if (version !== "3.0") {
    throw new Error(`Unsupported identity schema_version "${raw?.schema_version}".`);
  }

  const stripExperience = (entry) => ({
    id: entry.id ?? "",
    role: entry.role ?? "",
    company: entry.company ?? "",
    period: entry.period ?? "",
    location: "",
    progression: [],
  });

  return ZIdentity.parse({
    schema_version: "4.0",
    contact: raw.contact,
    experience: (raw.experience || []).map(stripExperience),
    other_experience_compacted: (raw.other_experience_compacted || []).map(stripExperience),
    education: raw.education || [],
    projects: raw.projects || [],
    certifications: raw.certifications || [],
    awards_or_contributions: raw.awards_or_contributions || [],
    skill_vetoes: [],
    legacy_skills: raw.technical_skills || [],
  });
}
