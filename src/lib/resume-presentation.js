import { balanceSkillLines } from "./skill-layout.js";

// The order a reader expects unless a style profile says otherwise. Section
// *arrangement* lives here and in the style profile; section *wording* does
// not, because a label is words on the page and words are the operator's.
export const DEFAULT_SECTION_ORDER = [
  "summary",
  "experience",
  "skills",
  "education",
  "projects",
  "certifications",
  "awards",
];

export const DEFAULT_SECTION_LABELS = {
  summary: "Summary",
  experience: "Experience",
  skills: "Skills",
  education: "Education",
  projects: "Projects",
  certifications: "Certifications",
  awards: "Awards & Contributions",
};

const CONTACT_LINK_KEYS = ["linkedin", "github", "portfolio"];

function toLink(label, url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return null;
  return { label: String(label ?? "").trim() || trimmed, url: trimmed };
}

export function normalizeCertification(entry) {
  if (typeof entry === "string") {
    return { name: entry.trim(), issuer: "", year: "", credentialUrl: null, text: entry.trim() };
  }
  const name = String(entry?.name ?? "").trim();
  const issuer = String(entry?.issuer ?? "").trim();
  const year = String(entry?.year ?? "").trim();
  // credential_url is the field the defect report found being dropped.
  // Preserving it is a correctness fix, not a styling one: a credential with
  // no link is a claim the reader cannot verify.
  const credentialUrl = String(entry?.credential_url ?? entry?.credentialUrl ?? "").trim() || null;
  return {
    name,
    issuer,
    year,
    credentialUrl,
    text: [name, issuer, year].filter(Boolean).join(", "),
  };
}

/**
 * Project a tailored resume into the single shape all three renderers read.
 *
 * Every renderer previously re-derived this projection inline, which is how a
 * credential URL could survive in one format and vanish in another.
 */
export function buildPresentation(resume, { profile, presentation = null } = {}) {
  const contact = resume?.contact && typeof resume.contact === "object" ? resume.contact : {};
  const maxPerLine = profile?.layout?.maxSkillsPerLine ?? 7;

  const groups = Array.isArray(presentation?.skillGroups) && presentation.skillGroups.length
    ? presentation.skillGroups
    : [{
      label: null,
      items: [...(resume?.skills_primary ?? []), ...(resume?.skills_secondary ?? [])],
    }];

  return {
    header: {
      name: contact.name ?? resume?.name ?? "",
      title: resume?.ats_title || resume?.target_role || "",
      location: contact.location ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    },
    links: CONTACT_LINK_KEYS.map((key) => toLink(key, contact[key])).filter(Boolean),
    summary: resume?.summary ?? "",
    skillGroups: groups.map((group) => ({
      label: group.label ?? null,
      items: group.items ?? [],
      lines: balanceSkillLines(group.items ?? [], { maxPerLine }),
    })),
    experience: resume?.experience ?? [],
    education: resume?.education ?? [],
    projects: (resume?.projects ?? []).map((project) => ({
      name: project.name ?? "",
      description: project.description ?? "",
      highlights: project.highlights ?? [],
      link: toLink(project.name, project.link),
    })),
    certifications: (resume?.certifications ?? []).map(normalizeCertification),
    awards: resume?.awards_or_contributions ?? [],
    sectionOrder: profile?.sectionOrder ?? DEFAULT_SECTION_ORDER,
    sectionLabels: { ...DEFAULT_SECTION_LABELS, ...(presentation?.sectionLabels ?? {}) },
  };
}
