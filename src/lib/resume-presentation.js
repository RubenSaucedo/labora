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

/**
 * The skill groups an operator approved, or null when there are none.
 *
 * This is the single decision point for whether a resume has an approved
 * grouping. The formatter projection and `buildPresentation` both call it, so
 * a group cannot survive into one and be dropped by the other — which is
 * exactly what happened when the two derived it independently.
 *
 * Approval is required because a group label is words on the page and a
 * grouping is an editorial claim about what a skill *is*. Anything an agent
 * proposed without a human confirming it is ignored here, and the caller falls
 * back to the automatic flat ranking.
 */
export function approvedSkillGroups(resume) {
  if (resume?.presentation?.approvedBy !== "operator") return null;
  const groups = resume.presentation.skillGroups;
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const usable = groups
    .map((group) => ({
      label: String(group?.label ?? "").trim(),
      items: (Array.isArray(group?.items) ? group.items : [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    }))
    .filter((group) => group.label && group.items.length);
  return usable.length ? usable : null;
}

/** Every approved skill, in group order then item order, with no cap applied. */
export function flattenSkillGroups(groups) {
  return (groups ?? []).flatMap((group) => group.items);
}

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

  const approved = approvedSkillGroups({ presentation });
  const groups = approved ?? [{
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
      // An approved group is rendered as the operator wrote it: one labelled
      // run, in their order. Width balancing exists to stop an automatic flat
      // list orphaning its last item, and re-partitioning an approved group
      // would move a skill out from under the label it was approved beneath.
      lines: approved
        ? [(group.items ?? []).join(", ")]
        : balanceSkillLines(group.items ?? [], { maxPerLine }),
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
    sectionLabels: {
      ...DEFAULT_SECTION_LABELS,
      // Labels are words, so the same operator approval that gates a grouping
      // gates a heading. Without it the shipped headings stand.
      ...(presentation?.approvedBy === "operator" ? (presentation.sectionLabels ?? {}) : {}),
    },
  };
}
