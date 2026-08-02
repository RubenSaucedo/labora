import { z } from "zod";

export const ZContact = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  linkedin: z.string(),
  github: z.string(),
  portfolio: z.string(),
}).strict();

export const ZBlankContact = ZContact.refine(
  (contact) => Object.values(contact).every((value) => value === ""),
  "Persisted resume contact fields must remain blank; inject contact only during rendering."
);

// A promotion or scope change inside one employer. Kept structured so a long
// tenure does not read as stagnation, and so an internal ladder token can be
// withheld from rendering without dropping the progression itself.
export const ZProgressionStep = z.object({
  label: z.string().min(1),
  // Rendered instead of `label` when the internal token means nothing outside
  // the company. Mirrors the claim `fact` / `externalFact` split.
  externalLabel: z.string().default(""),
  date: z.string().default(""),
  disclosure: z.enum(["public", "internal_generalizable", "internal_only"]).default("public"),
  claimIds: z.array(z.string()).default([]),
}).strict();

// The identity record holds identity only. Bullets live in the claim ledger and the
// accomplishment bank; a pre-written highlight here would anchor the tailor to a
// generic resume instead of composing from evidence.
export const ZExperience = z.object({
  id: z.string().default(""),
  role: z.string().default(""),
  company: z.string().default(""),
  period: z.string().default(""),
  location: z.string().default(""),
  progression: z.array(ZProgressionStep).default([]),
}).strict();

export const ZEducation = z.object({
  school: z.string().default(""),
  degree: z.string().default(""),
  location: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
}).strict();

export const ZProject = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
  highlights: z.array(z.string()).default([]),
  link: z.string().default(""),
}).strict();

export const ZCertification = z.object({
  name: z.string().default(""),
  issuer: z.string().default(""),
  year: z.string().default(""),
  // A credential URL is self-verifying evidence: a reader can confirm the
  // certification without trusting the resume. Blank when none was issued.
  credential_id: z.string().default(""),
  credential_url: z.string().default(""),
}).strict();

export const ZAward = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
  year: z.string().default(""),
  link: z.string().default(""),
}).strict();

/**
 * The identity record (schema 4.0) is the identity spine, not a resume.
 *
 * It carries only facts that must render exactly and are never tailored:
 * who the candidate is, where they worked, what they studied, what they hold.
 * `summary`, `key_achievements` and `technical_skills` were removed in 4.0 —
 * the first two were a pre-baked generic resume that anchored the tailor, and
 * the third was a hand-written allowlist that capped the resume below the
 * evidence. Substance now lives in claims.json and accomplishments.json.
 */
export const ZIdentity = z.object({
  schema_version: z.literal("4.0").default("4.0"),
  contact: ZBlankContact,
  experience: z.array(ZExperience).default([]),
  other_experience_compacted: z.array(ZExperience).default([]),
  education: z.array(ZEducation).default([]),
  projects: z.array(ZProject).default([]),
  certifications: z.array(ZCertification).default([]),
  awards_or_contributions: z.array(ZAward).default([]),
  // Labels that must never be displayed even when the bank demonstrates them.
  skill_vetoes: z.array(z.string()).default([]),
  // Populated only by normalizeIdentity() when reading a 3.0 document.
  legacy_skills: z.array(z.string()).default([]),
}).strict();
