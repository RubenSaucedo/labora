import { z } from "zod";
import { ZBlankContact, ZEducation, ZProject, ZCertification, ZAward } from "./identity.js";
import { ZPresentation } from "./resume-presentation.js";

/**
 * The résumé document.
 *
 * This is the whole contract between the conversation and the renderers: what a
 * person decided their résumé should say. It carries no provenance, no claim
 * IDs and no keyword map, because nothing downstream validates a sentence
 * against a compiled ledger any more.
 *
 * That machinery was removed deliberately. Requiring every sentence to resolve
 * to a claim derived from files produced false gaps constantly -- this
 * repository's own history records requirements reported missing while the
 * claims satisfying them were rendered on the page, and a candidate reported
 * unfit because a live product's repository was private. A résumé describes a
 * person's own career; they are the source of truth for it, and the way to stay
 * honest is to ask them, not to refuse them.
 *
 * What replaces it is conversational: the assistant writes what the person
 * tells it, asks when something is vague, says plainly when it is suggesting
 * wording rather than repeating theirs, and never widens scope, ownership or a
 * number on its own.
 */
export const ZResumeExperience = z.object({
  id: z.string().default(""),
  company: z.string().default(""),
  role: z.string().default(""),
  period: z.string().default(""),
  location: z.string().default(""),
  bullets: z.array(z.string()).default([]),
}).strict();

export const ZResume = z.object({
  schema_version: z.literal("4.0").default("4.0"),
  target_role: z.string().default(""),
  ats_title: z.string().default(""),
  // Stays blank in the stored document and is injected at render time from
  // profile/contact.md, so a résumé committed or shared by accident carries no
  // contact details.
  contact: ZBlankContact,
  summary: z.string().default(""),
  skills_primary: z.array(z.string()).default([]),
  skills_secondary: z.array(z.string()).default([]),
  experience: z.array(ZResumeExperience).default([]),
  education: z.array(ZEducation).default([]),
  projects: z.array(ZProject).default([]),
  certifications: z.array(ZCertification).default([]),
  awards_or_contributions: z.array(ZAward).default([]),
  // Section labels and skill groupings the person chose. Null means the style
  // profile's defaults.
  presentation: ZPresentation.nullable().default(null),
  // Shared working notes between the person and the assistant: open questions,
  // things to confirm, wording someone wants to revisit. Never rendered.
  notes: z.array(z.string()).default([]),
}).strict();

/**
 * Documents written under the previous schema still open.
 *
 * A person's résumé is not invalidated by us changing our mind about
 * architecture. The claim-era fields are dropped on read rather than rejected,
 * and the content -- which is the part they wrote -- survives untouched.
 */
export function readResume(raw) {
  if (!raw || typeof raw !== "object") return ZResume.parse(raw);
  const {
    provenance,
    keywords_mapped,
    gaps_or_risks,
    notes_for_human,
    schema_version,
    experience,
    ...rest
  } = raw;
  return ZResume.parse({
    ...rest,
    schema_version: "4.0",
    notes: raw.notes ?? notes_for_human ?? [],
    experience: (experience || []).map(({ progression, ...role }) => role),
  });
}
