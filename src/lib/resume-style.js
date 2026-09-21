// Named resume style profiles.
//
// One registry, read by every renderer. A profile is validated data (see
// src/schemas/resume-style.js); the renderers hold no visual constants of their
// own, so DOCX and HTML/PDF cannot drift into two different-looking documents
// that claim the same style name.
//
// A style never touches content. Nothing here can reorder, rewrite, rank, omit,
// or invent a bullet — the only things a profile decides are typography,
// spacing, colour, rules, contact-row grouping, and pagination behaviour.
//
// Unit conversion lives here rather than in the renderers, because the two
// targets measure in different units and the rounding has to be stated once:
//
//   pt   -> half-points (DOCX)   Math.round(pt * 2)
//        Word stores font size in half-points, an integer. A profile may name a
//        fractional point size that CSS renders exactly and Word cannot: 10.15pt
//        becomes 20 half-points, i.e. 10pt. The CSS side keeps the exact value;
//        the DOCX side is the nearest representable one.
//   px   -> twips (DOCX)         Math.round(px * 15)
//        CSS pixels are 1/96in and a twip is 1/1440in, so 1px = 15 twips
//        exactly. Fractional pixel gaps (3.5px) round to the nearest twip.
//   in   -> twips (DOCX)         Math.round(inches * 1440)
//        Profiles state marginTwips explicitly so a deliberate Word-side value
//        is never silently re-derived; assertion below keeps the two honest.
//   pt   -> eighths of a point (DOCX borders)   Math.round(pt * 8)
//   lineHeight -> 240ths of a line (DOCX)       Math.round(lineHeight * 240)

// Deliberately zero imports. Freshness tracking (`labora run-state`) resolves
// style IDs to build artifact names, and run-state has to keep working on a
// machine where no npm package is installed at all — labora's degraded advisory
// mode depends on it. Shape validation therefore lives in
// src/schemas/resume-style.js (zod) and runs at the render boundary in
// src/agents/format-resume.js, where a renderer is already a heavy-dependency
// path; test/resume-style.test.js holds the two to the same profiles so the
// split cannot drift.

const PROFILE_SOURCES = [
  {
    id: "precision-minimal",
    displayName: "Precision Minimal",
    signal: "restrained, direct, technical",
    fonts: {
      body: ["Arial", "Helvetica", "sans-serif"],
      display: ["Arial", "Helvetica", "sans-serif"],
    },
    sizes: {
      name: 23,
      positioning: 10.4,
      section: 11.4,
      role: 10.5,
      metadata: 9.35,
      body: 10,
    },
    lineHeight: 1.34,
    page: { marginInches: 0.65, marginTwips: 936 },
    spacing: {
      paragraphPx: 6,
      sectionPx: 13,
      rolePx: 10,
      skillPx: 4,
      bulletPx: 3.5,
    },
    colors: {
      body: "#191d21",
      heading: "#11161a",
      muted: "#4f5b63",
      accent: "#184e6b",
      name: "#102f40",
      rule: "#a9bdc8",
    },
    sectionRule: { enabled: true, weight: "thin", thicknessPt: 0.75 },
    positioning: { bold: true, italic: false },
    contactRows: [
      ["location", "email", "phone"],
      ["linkedin", "github", "portfolio"],
    ],
    pagination: {
      headingKeepWithNext: true,
      roleKeepWithNext: true,
      bulletKeepTogether: true,
      roleBlockKeepTogether: true,
    },
    links: { underline: true },
    layout: { minFinalPageFillPercent: 55, maxSkillsPerLine: 7 },
    sectionOrder: [
      "summary", "experience", "skills", "education", "projects", "certifications", "awards",
    ],
  },
  {
    id: "editorial-technical",
    displayName: "Editorial Technical",
    signal: "mature, deliberate, readable",
    fonts: {
      // A serif display face over a sans-serif body is the whole point of this
      // profile, and the reason one shared `font` token was not enough.
      body: ["Arial", "Helvetica", "sans-serif"],
      display: ["Georgia", "Times New Roman", "serif"],
    },
    sizes: {
      name: 24,
      positioning: 10.4,
      section: 12.1,
      role: 10.7,
      metadata: 9.45,
      body: 10.15,
    },
    lineHeight: 1.38,
    page: { marginInches: 0.7, marginTwips: 1008 },
    spacing: {
      paragraphPx: 7,
      sectionPx: 14,
      rolePx: 11,
      skillPx: 4.5,
      bulletPx: 4,
    },
    colors: {
      body: "#242424",
      heading: "#20252a",
      muted: "#535c64",
      accent: "#334155",
      name: "#1e293b",
      rule: "#aeb6bf",
    },
    sectionRule: { enabled: true, weight: "quiet", thicknessPt: 0.5 },
    positioning: { bold: false, italic: true },
    contactRows: [
      ["location", "email", "phone"],
      ["linkedin", "github", "portfolio"],
    ],
    pagination: {
      headingKeepWithNext: true,
      roleKeepWithNext: true,
      bulletKeepTogether: true,
      roleBlockKeepTogether: true,
    },
    links: { underline: true },
    layout: { minFinalPageFillPercent: 55, maxSkillsPerLine: 7 },
    sectionOrder: [
      "summary", "experience", "skills", "education", "projects", "certifications", "awards",
    ],
  },
];

function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) freezeDeep(entry);
    Object.freeze(value);
  }
  return value;
}

// Cross-field invariant that no per-field schema can state: the two page
// measures must describe the same page. Checked at load so a mistyped profile
// fails for everyone rather than in one application run.
const BUILT_IN_PROFILES = new Map(
  PROFILE_SOURCES.map((profile) => {
    if (Math.round(profile.page.marginInches * 1440) !== profile.page.marginTwips) {
      throw new Error(
        `Style "${profile.id}" declares ${profile.page.marginInches}in margins but ` +
        `${profile.page.marginTwips} twips; DOCX and PDF would not share a page measure.`
      );
    }
    return [profile.id, freezeDeep(profile)];
  })
);

export const DEFAULT_STYLE_ID = "precision-minimal";

/** @returns {string[]} Every accepted profile ID, sorted for stable messages. */
export function styleProfileIds() {
  return [...BUILT_IN_PROFILES.keys()].sort();
}

/** @returns {Array<{id: string, displayName: string, signal: string}>} */
export function listStyleProfiles() {
  return styleProfileIds().map((id) => {
    const profile = BUILT_IN_PROFILES.get(id);
    return { id: profile.id, displayName: profile.displayName, signal: profile.signal };
  });
}

/**
 * Resolve a style ID to its validated profile.
 *
 * An unknown ID is an error, never a fallback. Silently rendering a different
 * profile than the one that was reviewed makes the artifact's own provenance
 * wrong, and nothing downstream can detect it.
 *
 * @param {string|object} [idOrProfile] - Profile ID, or an already-resolved profile.
 * @returns {object} Frozen, validated style profile.
 */
export function resolveStyleProfile(idOrProfile = DEFAULT_STYLE_ID) {
  if (idOrProfile && typeof idOrProfile === "object") return freezeDeep(idOrProfile);
  const id = String(idOrProfile ?? "").trim();
  const profile = BUILT_IN_PROFILES.get(id);
  if (!profile) {
    throw new Error(
      `Unknown resume style "${id || "(empty)"}". Accepted styles: ${styleProfileIds().join(", ")}.`
    );
  }
  return profile;
}

export function ptToHalfPoints(pt) {
  return Math.round(pt * 2);
}

export function pxToTwips(px) {
  return Math.round(px * 15);
}

export function inchesToTwips(inches) {
  return Math.round(inches * 1440);
}

export function ptToEighths(pt) {
  return Math.round(pt * 8);
}

export function lineHeightToTwentieths(lineHeight) {
  return Math.round(lineHeight * 240);
}

function docxColor(hex) {
  return hex.replace("#", "").toUpperCase();
}

function mapValues(source, transform) {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, transform(value)]));
}

/**
 * Word-side tokens. Sizes are half-points, spacing and margins are twips,
 * colours are RRGGBB without the leading hash.
 */
export function docxStyleTokens(idOrProfile) {
  const profile = resolveStyleProfile(idOrProfile);
  return freezeDeep({
    id: profile.id,
    displayName: profile.displayName,
    // Word names a single family per run; the stack's first entry is the one a
    // machine is actually expected to have.
    fontBody: profile.fonts.body[0],
    fontDisplay: profile.fonts.display[0],
    sizes: mapValues(profile.sizes, ptToHalfPoints),
    line: lineHeightToTwentieths(profile.lineHeight),
    margin: profile.page.marginTwips,
    spacing: {
      paragraph: pxToTwips(profile.spacing.paragraphPx),
      section: pxToTwips(profile.spacing.sectionPx),
      role: pxToTwips(profile.spacing.rolePx),
      skill: pxToTwips(profile.spacing.skillPx),
      bullet: pxToTwips(profile.spacing.bulletPx),
    },
    colors: mapValues(profile.colors, docxColor),
    sectionRule: {
      enabled: profile.sectionRule.enabled,
      size: ptToEighths(profile.sectionRule.thicknessPt),
      color: docxColor(profile.colors.rule),
    },
    positioning: { bold: profile.positioning.bold, italics: profile.positioning.italic },
    pagination: profile.pagination,
    links: profile.links,
  });
}

/**
 * Browser-side tokens. Sizes keep the exact point value the profile declares,
 * fonts keep the whole stack, colours keep CSS hex.
 */
export function cssStyleTokens(idOrProfile) {
  const profile = resolveStyleProfile(idOrProfile);
  return freezeDeep({
    id: profile.id,
    displayName: profile.displayName,
    fontBody: profile.fonts.body.join(", "),
    fontDisplay: profile.fonts.display.join(", "),
    sizes: mapValues(profile.sizes, (pt) => `${pt}pt`),
    lineHeight: profile.lineHeight,
    margin: `${profile.page.marginInches}in`,
    spacing: {
      paragraph: `${profile.spacing.paragraphPx}px`,
      section: `${profile.spacing.sectionPx}px`,
      role: `${profile.spacing.rolePx}px`,
      skill: `${profile.spacing.skillPx}px`,
      bullet: `${profile.spacing.bulletPx}px`,
    },
    colors: { ...profile.colors },
    sectionRule: {
      enabled: profile.sectionRule.enabled,
      border: `${profile.sectionRule.thicknessPt}pt solid ${profile.colors.rule}`,
    },
    positioning: {
      weight: profile.positioning.bold ? "700" : "400",
      style: profile.positioning.italic ? "italic" : "normal",
    },
    pagination: profile.pagination,
    links: profile.links,
  });
}

/** Both renderers' tokens plus the profile they were derived from. */
export function styleTokens(idOrProfile) {
  const profile = resolveStyleProfile(idOrProfile);
  return { profile, docx: docxStyleTokens(profile), css: cssStyleTokens(profile) };
}

const CONTACT_LINK_SCHEMES = {
  email: (value) => (/^mailto:/i.test(value) ? value : `mailto:${value}`),
  linkedin: webHref,
  github: webHref,
  portfolio: webHref,
};

function webHref(value) {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^\/\//.test(value)) return `https:${value}`;
  // "linkedin.com/in/jane-example" is a destination; "Seattle, WA" is not.
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(value)) return `https://${value}`;
  return null;
}

/**
 * Turn header values into the profile's deterministic contact rows.
 *
 * Grouping comes from the profile, not from where the text happens to wrap, so
 * the same header renders identically in Word and in print. Values live only in
 * the caller's header object: a style profile stores which keys share a row and
 * never a person's contact details.
 *
 * @param {object} header - Renderer header (location, email, phone, linkedin, github, portfolio).
 * @param {string|object} [idOrProfile]
 * @returns {Array<Array<{key: string, text: string, href: string|null}>>} Non-empty rows only.
 */
export function contactRows(header = {}, idOrProfile = DEFAULT_STYLE_ID) {
  const profile = resolveStyleProfile(idOrProfile);
  const rows = [];
  for (const keys of profile.contactRows) {
    const row = [];
    for (const key of keys) {
      const raw = header?.[key];
      if (typeof raw !== "string" || !raw.trim()) continue;
      const text = raw.trim();
      const href = CONTACT_LINK_SCHEMES[key]?.(text) ?? null;
      row.push({ key, text, href });
    }
    if (row.length) rows.push(row);
  }
  return rows;
}

/** Href for a link-bearing non-contact value (project links, award links). */
export function linkHref(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return webHref(value.trim());
}
