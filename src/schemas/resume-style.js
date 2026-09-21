import { z } from "zod";

// A resume style profile is *data*, never renderer-specific branches. Both the
// DOCX writer and the HTML/PDF writer read the same validated object, so a
// visual decision can only be made once. If a renderer needs a value this
// schema does not carry, the fix is a field here — not a constant in one
// renderer that the other never learns about.
//
// Nothing in this schema can reach resume *content*: there is no field for
// wording, ranking, or inclusion. A style may change how a sentence looks and
// may not change which sentences exist.
//
// Section *order* is the one arrangement decision that lives here, and it is
// not an exception to that rule. Reordering sections invents no words, removes
// none, and changes no claim; it decides what a reader meets first. Section
// *labels* are words, so they live in the operator-approved presentation block
// instead — the line is drawn at whether a field can introduce text.

const ZHexColor = z.string().regex(
  /^#[0-9a-f]{6}$/i,
  "colors are six-digit hex so DOCX (RRGGBB) and CSS (#RRGGBB) derive from one value",
);

const ZFontStack = z.array(z.string().min(1)).min(2).describe(
  "CSS font stack, most specific first. DOCX names a single font, so the first " +
  "entry must be the family that is actually expected to be installed.",
);

const ZPointSize = z.number().positive().max(72);

// Contact fields are grouped deterministically instead of being concatenated
// into one paragraph and left to wrap wherever the measure happens to end. The
// schema stores only *which* header keys sit in which row; the values are
// injected at render time and are never stored here.
const ZContactRowKey = z.enum([
  "location",
  "email",
  "phone",
  "linkedin",
  "github",
  "portfolio",
]);

export const ZResumeStyleProfile = z.object({
  id: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "profile IDs are stable kebab-case names"),
  displayName: z.string().min(1),
  // Plain-language intent, so a reviewer can tell which profile they approved
  // without opening a rendered page.
  signal: z.string().min(1),

  fonts: z.object({
    body: ZFontStack,
    display: ZFontStack,
  }).strict(),

  sizes: z.object({
    name: ZPointSize,
    positioning: ZPointSize,
    section: ZPointSize,
    role: ZPointSize,
    metadata: ZPointSize,
    body: ZPointSize,
  }).strict(),

  lineHeight: z.number().min(1).max(2),

  page: z.object({
    marginInches: z.number().positive().max(2),
    // Stated rather than derived: Word stores margins in twips, and a profile
    // that rounds differently from inches * 1440 must be able to say so.
    marginTwips: z.number().int().positive(),
  }).strict(),

  // CSS pixel gaps at 96 dpi. The DOCX renderer converts them; see
  // pxToTwips in src/lib/resume-style.js for the documented rounding.
  spacing: z.object({
    paragraphPx: z.number().nonnegative(),
    sectionPx: z.number().nonnegative(),
    rolePx: z.number().nonnegative(),
    skillPx: z.number().nonnegative(),
    bulletPx: z.number().nonnegative(),
  }).strict(),

  colors: z.object({
    body: ZHexColor,
    heading: ZHexColor,
    muted: ZHexColor,
    accent: ZHexColor,
    name: ZHexColor,
    rule: ZHexColor,
  }).strict(),

  sectionRule: z.object({
    enabled: z.boolean(),
    // "thin" and "quiet" are the two reviewed weights; both render as a hairline
    // rule, quiet at a lighter measure.
    weight: z.enum(["thin", "quiet"]),
    thicknessPt: z.number().positive().max(2),
  }).strict(),

  positioning: z.object({
    bold: z.boolean(),
    italic: z.boolean(),
  }).strict(),

  contactRows: z.array(z.array(ZContactRowKey).min(1)).min(1),

  pagination: z.object({
    // Word: w:keepNext. CSS: break-after: avoid. A heading stranded at the foot
    // of a page reads as a missing section.
    headingKeepWithNext: z.boolean(),
    roleKeepWithNext: z.boolean(),
    // Word: w:keepLines. CSS: break-inside: avoid. A bullet split across pages
    // loses its measurement half.
    bulletKeepTogether: z.boolean(),
    roleBlockKeepTogether: z.boolean(),
  }).strict(),

  links: z.object({
    // Colour alone is not a link affordance: it disappears in greyscale print
    // and for readers who cannot distinguish the hue.
    underline: z.boolean(),
  }).strict(),

  // Thresholds, not wording. `minFinalPageFillPercent` says how full the last
  // page must be before the distribution reads as deliberate rather than
  // accidental; `maxSkillsPerLine` caps a skill row. Neither can reach content,
  // and neither refuses: both only produce findings, because v7 returned the
  // send decision to the operator.
  layout: z.object({
    minFinalPageFillPercent: z.number().min(0).max(100),
    maxSkillsPerLine: z.number().int().min(3).max(12),
  }).strict(),
  // Arrangement, not wording. The enum is closed so a profile cannot name a
  // section no renderer knows how to emit, which would otherwise drop content
  // silently. A section absent from the resume is skipped, not empty-rendered.
  sectionOrder: z.array(z.enum([
    "summary", "experience", "skills", "education", "projects", "certifications", "awards",
  ])).min(1),
}).strict();

/**
 * Validate a candidate style profile before anything renders it.
 *
 * The registry itself (src/lib/resume-style.js) imports nothing, because
 * freshness tracking has to run with no dependency installed. Validation
 * therefore happens here, on the render path, which already needs zod.
 *
 * @param {unknown} candidate
 * @returns {import("zod").infer<typeof ZResumeStyleProfile>}
 */
export function parseResumeStyleProfile(candidate) {
  const parsed = ZResumeStyleProfile.safeParse(candidate);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid resume style profile — ${detail}`);
  }
  return parsed.data;
}
