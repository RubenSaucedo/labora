import { z } from "zod";

// The presentation block holds the two things a style profile deliberately
// cannot: words on the page, and a regrouping of content. Both introduce or
// rearrange text a reader will attribute to the candidate, so both require a
// human. `approvedBy: "operator"` is the whole point of the field — an agent
// can propose a block, but an unapproved one never renders.

export const SECTION_KEYS = [
  "summary",
  "experience",
  "skills",
  "education",
  "projects",
  "certifications",
  "awards",
];

const ZSectionLabels = z.object(
  Object.fromEntries(SECTION_KEYS.map((key) => [key, z.string().min(1).max(60).optional()]))
).strict();

const ZSkillGroup = z.object({
  label: z.string().min(1).max(60),
  items: z.array(z.string().min(1)).min(1),
}).strict();

export const ZPresentation = z.object({
  sectionLabels: ZSectionLabels.default({}),
  skillGroups: z.array(ZSkillGroup).default([]),
  approvedBy: z.literal("operator", {
    errorMap: () => ({
      message: "approvedBy must be \"operator\": a label or grouping an agent chose may not render unreviewed.",
    }),
  }),
}).strict();

function normalizeSkill(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Validate a presentation block against the resume it will be rendered with.
 *
 * Shape alone is not enough. A skill group is an arrangement of skills the
 * resume already claims, so every item must already be in the resume; without
 * this check the block would be a second, unvalidated route for a skill to
 * reach the page, which is exactly what claim validation exists to prevent.
 *
 * @param {unknown} candidate
 * @param {{ skills_primary?: string[], skills_secondary?: string[] }} resume
 */
export function parsePresentation(candidate, resume) {
  const parsed = ZPresentation.parse(candidate);
  const known = new Set([
    ...(resume?.skills_primary ?? []),
    ...(resume?.skills_secondary ?? []),
  ].map(normalizeSkill));

  for (const group of parsed.skillGroups) {
    for (const item of group.items) {
      if (!known.has(normalizeSkill(item))) {
        throw new Error(
          `Skill "${item}" in presentation group "${group.label}" is not present in the resume.`
        );
      }
    }
  }

  const grouped = parsed.skillGroups.flatMap((group) => group.items.map(normalizeSkill));
  const duplicates = grouped.filter((item, index) => grouped.indexOf(item) !== index);
  if (duplicates.length) {
    // A skill printed twice reads as padding, and the count a reader forms
    // stops matching the count the resume claims.
    throw new Error(`Skill "${duplicates[0]}" appears in more than one presentation group.`);
  }

  return parsed;
}
