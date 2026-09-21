import { layoutFindings } from "./layout-findings.js";
import {
  normalizeCertification,
  DEFAULT_SECTION_ORDER,
  DEFAULT_SECTION_LABELS,
} from "./resume-presentation.js";
import { linkHref } from "./resume-style.js";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/-\s+/g, "-")
    .replace(/[^\p{L}\p{N}+#./%@-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expectedArtifact(
  resume,
  sectionOrder = DEFAULT_SECTION_ORDER,
  sectionLabels = DEFAULT_SECTION_LABELS,
) {
  const fields = [];
  const sections = [];
  const links = [];
  const add = (location, value) => {
    if (value != null && String(value).trim()) fields.push({ location, value: String(value) });
  };
  // A URL a renderer prints as text but never turns into a relationship reads
  // as present to every text check and is dead to the person holding the page,
  // so expected link targets are collected separately from expected words.
  // linkHref is the same normaliser the renderers use, so a profile written
  // without a scheme is compared against the href they actually emitted.
  const addLink = (location, url) => {
    const href = linkHref(String(url ?? "").trim());
    if (href) links.push({ location, url: href });
  };

  const header = resume.header || {};
  for (const key of ["name", "title", "location", "email", "phone", "linkedin", "github", "portfolio"]) {
    add(`header.${key}`, header[key]);
  }
  for (const key of ["linkedin", "github", "portfolio"]) addLink(`header.${key}`, header[key]);

  // Section collection mirrors the renderers: one collector per section, run in
  // the declared order. The previous fixed sequence asserted a literal heading
  // list, so a document that legitimately reordered or relabelled a section
  // failed the gate that exists to catch a section going missing.
  const collectors = {
    summary: () => {
      if (!resume.summary) return false;
      add("summary", resume.summary);
      return true;
    },
    experience: () => {
      if (!(resume.experience || []).length) return false;
      for (const [index, entry] of resume.experience.entries()) {
        for (const key of ["company", "role", "startDate", "endDate", "location"]) {
          add(`experience[${index}].${key}`, entry[key]);
        }
        for (const [bulletIndex, bullet] of (entry.highlights || []).entries()) {
          add(`experience[${index}].highlights[${bulletIndex}]`, bullet);
        }
      }
      return true;
    },
    skills: () => {
      // An approved grouping is part of what the artifact must show. Expecting
      // only the bare skills would let a renderer flatten the groups away and
      // still report 100% recall, because every individual word still appears.
      const groups = Array.isArray(resume.skillGroups) ? resume.skillGroups : null;
      if (groups && groups.length) {
        for (const [index, group] of groups.entries()) {
          add(`skillGroups[${index}].label`, group?.label);
          for (const [itemIndex, item] of (group?.items ?? []).entries()) {
            add(`skillGroups[${index}].items[${itemIndex}]`, item);
          }
        }
        return true;
      }
      const skills = Array.isArray(resume.skills)
        ? resume.skills
        : (typeof resume.skills === "string"
          ? [resume.skills]
          : Object.values(resume.skills || {}).flat());
      if (!skills.length) return false;
      for (const [index, skill] of skills.entries()) add(`skills[${index}]`, skill);
      return true;
    },
    education: () => {
      if (!(resume.education || []).length) return false;
      for (const [index, education] of resume.education.entries()) {
        for (const key of ["school", "degree", "field", "startDate", "endDate", "location"]) {
          add(`education[${index}].${key}`, education[key]);
        }
      }
      return true;
    },
    projects: () => {
      if (!(resume.projects || []).length) return false;
      for (const [index, project] of resume.projects.entries()) {
        for (const key of ["name", "description", "link"]) add(`projects[${index}].${key}`, project[key]);
        addLink(`projects[${index}].link`, project.link);
        for (const [highlightIndex, highlight] of (project.highlights || []).entries()) {
          add(`projects[${index}].highlights[${highlightIndex}]`, highlight);
        }
      }
      return true;
    },
    certifications: () => {
      if (!(resume.certifications || []).length) return false;
      for (const [index, certification] of resume.certifications.entries()) {
        // Certifications carry a credential URL now, so the displayed text is a
        // field on the entry rather than the entry itself.
        const cert = normalizeCertification(certification);
        add(`certifications[${index}]`, cert.text);
        addLink(`certifications[${index}].credentialUrl`, cert.credentialUrl);
      }
      return true;
    },
    awards: () => {
      if (!(resume.awards_or_contributions || []).length) return false;
      for (const [index, award] of resume.awards_or_contributions.entries()) {
        for (const key of ["title", "description", "year", "link"]) {
          add(`awards_or_contributions[${index}].${key}`, award?.[key]);
        }
        addLink(`awards_or_contributions[${index}].link`, award?.link);
      }
      return true;
    },
  };

  for (const key of sectionOrder) {
    const collect = collectors[key];
    if (!collect) continue;
    if (collect()) sections.push(sectionLabels[key] ?? DEFAULT_SECTION_LABELS[key] ?? key);
  }

  return { fields, sections, links };
}

/**
 * Where a group's label is printed *as a label*.
 *
 * A bare substring search is not enough: group labels are ordinary words, and
 * "Platform" or "Data" also occur inside experience bullets. Matching one of
 * those made the label look like it appeared before the skills section, which
 * failed the order check on a perfectly correct render.
 *
 * Every renderer prints a group as "Label: first, second", which normalises to
 * "label first second". Requiring the first approved skill to follow the label
 * anchors the match to the skills row and to nothing else.
 *
 * A group whose first item is missing therefore reports as a missing label
 * rather than a missing item. Both are failures, and recall names the absent
 * skill separately, so the diagnosis stays findable.
 */
function skillGroupLabelPosition(normalizedText, label, items) {
  const needle = normalize(label);
  if (!needle) return -1;
  const firstItem = items.map((item) => normalize(item)).find(Boolean);
  if (!firstItem) return normalizedText.indexOf(needle);

  for (let from = 0; from <= normalizedText.length;) {
    const at = normalizedText.indexOf(needle, from);
    if (at < 0) return -1;
    if (normalizedText.startsWith(`${needle} ${firstItem}`, at)) return at;
    from = at + 1;
  }
  return -1;
}

/**
 * Check that an approved skill grouping survived into the rendered text.
 *
 * Field recall alone cannot see this. If a renderer flattens three approved
 * groups into one ranked list, every skill word is still present and recall
 * still reads 100%, while the structure the operator approved is gone. So the
 * grouping is checked positionally: labels must appear in the approved order,
 * and each group's skills must appear inside that group's span rather than
 * merely somewhere on the page.
 */
function skillGroupIssues(resume, normalizedText) {
  const groups = Array.isArray(resume?.skillGroups) ? resume.skillGroups : null;
  if (!groups || !groups.length) return [];

  const issues = [];
  const positions = groups.map((group) => skillGroupLabelPosition(
    normalizedText,
    String(group?.label ?? "").trim(),
    Array.isArray(group?.items) ? group.items : []
  ));

  for (const [index, at] of positions.entries()) {
    if (at < 0) {
      issues.push({
        severity: "error",
        code: "missing_skill_group_label",
        field: `skillGroups[${index}].label`,
      });
    }
  }

  const present = positions
    .map((at, index) => ({ at, index }))
    .filter((entry) => entry.at >= 0);
  const outOfOrder = present.some((entry, rank) => rank > 0 && entry.at <= present[rank - 1].at);
  if (outOfOrder) {
    issues.push({ severity: "error", code: "skill_group_order", field: "skillGroups" });
  }

  // Spans are measured between labels in printed order. Taking them in declared
  // order would make a single reordered group produce a backwards span and
  // report every one of its skills as misplaced.
  const printed = [...present].sort((a, b) => a.at - b.at);
  for (const [rank, entry] of printed.entries()) {
    const start = entry.at;
    // The group's span ends where the next printed label begins; the last group
    // runs to the end of the document.
    const end = rank + 1 < printed.length ? printed[rank + 1].at : normalizedText.length;
    for (const [itemIndex, item] of (groups[entry.index]?.items ?? []).entries()) {
      const needle = normalize(item);
      if (!needle) continue;
      const found = normalizedText.indexOf(needle, start);
      if (found < 0 || found >= end) {
        issues.push({
          severity: "error",
          code: "skill_outside_approved_group",
          field: `skillGroups[${entry.index}].items[${itemIndex}]`,
        });
      }
    }
  }

  return issues;
}

function countOccurrences(text, value) {
  if (!value) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= text.length - value.length) {
    const index = text.indexOf(value, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + value.length;
  }
  return count;
}

/**
 * Given the expected fields and an already-normalized extracted text, return the
 * `location` of every field the text fails to recover (accounting for repeated
 * identical values). Shared by full artifact validation and cross-parser
 * divergence so both judge parseability with the same recall logic.
 */
function missingFieldLocations(expectedFields, normalizedText) {
  const fieldsByValue = new Map();
  for (const field of expectedFields) {
    const value = normalize(field.value);
    const entries = fieldsByValue.get(value) || [];
    entries.push(field);
    fieldsByValue.set(value, entries);
  }
  const missing = [];
  for (const [value, fields] of fieldsByValue) {
    const renderedCount = countOccurrences(normalizedText, value);
    for (const field of fields.slice(renderedCount)) missing.push(field.location);
  }
  return missing;
}

export function validateRenderedArtifact({
  resume,
  extractedText,
  layout = null,
  profile = null,
  linkTargets = null,
  sectionOrder = null,
  sectionLabels = null,
}) {
  const normalizedText = normalize(extractedText);
  const expected = expectedArtifact(
    resume,
    // A caller may declare the order directly, or leave it to the style profile
    // that produced the artifact. Only the shipped default remains if neither
    // says anything, which is what every existing application relies on.
    sectionOrder ?? profile?.sectionOrder ?? DEFAULT_SECTION_ORDER,
    { ...DEFAULT_SECTION_LABELS, ...(sectionLabels ?? {}) },
  );
  const missingFields = missingFieldLocations(expected.fields, normalizedText);

  const sectionPositions = expected.sections.map((section) => ({
    section,
    index: normalizedText.indexOf(normalize(section)),
  }));
  const missingSections = sectionPositions
    .filter((entry) => entry.index < 0)
    .map((entry) => entry.section);
  const presentSections = sectionPositions.filter((entry) => entry.index >= 0);
  const sectionOrderValid = missingSections.length === 0 && presentSections.every((entry, index) =>
    index === 0 || entry.index > presentSections[index - 1].index
  );

  const requiredContact = ["name", "email", "phone"];
  const missingContact = requiredContact.filter((key) => !resume.header?.[key]);
  const recall = expected.fields.length === 0
    ? 100
    : Math.round(((expected.fields.length - missingFields.length) / expected.fields.length) * 100);

  const issues = [];
  for (const field of missingFields) issues.push({ severity: "error", code: "missing_rendered_field", field });
  for (const section of missingSections) issues.push({ severity: "error", code: "missing_section", field: section });
  for (const field of missingContact) issues.push({ severity: "error", code: "missing_contact", field: `header.${field}` });
  if (!sectionOrderValid) issues.push({ severity: "error", code: "section_order", field: "document" });

  issues.push(...skillGroupIssues(resume, normalizedText));

  // `null` means the caller could not read relationships out of this format,
  // which is not the same as the format having none. Only an actual list can
  // establish that a link is missing.
  let missingLinkTargets = [];
  if (Array.isArray(linkTargets)) {
    const present = new Set(linkTargets.map((url) => String(url ?? "").trim().replace(/\/+$/, "")));
    missingLinkTargets = expected.links
      .filter((entry) => !present.has(entry.url.replace(/\/+$/, "")))
      .map((entry) => entry.location);
    for (const field of missingLinkTargets) {
      issues.push({ severity: "error", code: "missing_link_target", field });
    }
  }

  // Layout findings are advisory by construction. `valid` is computed from
  // errors only, so a warning here can never overturn the recall verdict —
  // the same separation crossParserDivergence already relies on.
  let layoutReport = null;
  if (layout) {
    const findings = layoutFindings({ layout, skills: resume.skills, profile });
    layoutReport = findings.layout;
    issues.push(...findings.issues);
  }

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    fieldRecallPercent: recall,
    fieldRecallScope: "renderer_input",
    sectionOrderValid,
    missingFields,
    missingSections,
    missingContact,
    missingLinkTargets,
    layout: layoutReport,
    issues,
  };
}

/**
 * Compare two independent text extractions of the same rendered artifact and
 * report where they disagree on field recovery. A field one parser recovers but
 * another drops is a real-world ATS fragility signal: production parsers differ
 * (text-layer extraction vs. a visual/OCR read), so a resume that only survives
 * one parser may be silently mangled by an employer's stack.
 *
 * Pure and deterministic. Divergences are advisory (warnings), never hard
 * failures — the primary parser still owns the pass/fail recall verdict.
 *
 * @param {{ resume: object, primaryText: string, secondaryText: string, secondaryParser?: string }} input
 */
export function crossParserDivergence({ resume, primaryText, secondaryText, secondaryParser = "secondary" }) {
  const expected = expectedArtifact(resume);
  const primaryMissing = new Set(missingFieldLocations(expected.fields, normalize(primaryText)));
  const secondaryMissing = new Set(missingFieldLocations(expected.fields, normalize(secondaryText)));

  const onlyPrimaryMissing = [...primaryMissing].filter((location) => !secondaryMissing.has(location));
  const onlySecondaryMissing = [...secondaryMissing].filter((location) => !primaryMissing.has(location));
  const divergentFields = [...new Set([...onlyPrimaryMissing, ...onlySecondaryMissing])].sort();

  const total = expected.fields.length;
  const agreementPercent = total === 0
    ? 100
    : Math.round(((total - divergentFields.length) / total) * 100);

  const issues = divergentFields.map((field) => ({
    severity: "warning",
    code: "cross_parser_divergence",
    field,
    detail: onlyPrimaryMissing.includes(field)
      ? `Recovered by ${secondaryParser} but not the primary parser.`
      : `Recovered by the primary parser but not ${secondaryParser}.`,
  }));

  return {
    secondaryParser,
    agreementPercent,
    divergentFields,
    onlyPrimaryMissing,
    onlySecondaryMissing,
    issues,
  };
}
