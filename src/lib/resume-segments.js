import crypto from "node:crypto";

/**
 * The addressable document model.
 *
 * Editing a resume requires naming the thing being edited. Every stage in the
 * editorial path -- the baseline diff, the editorial plan, the whole-document
 * audit, the skills/projects dependency graph -- needs to say "this span" and
 * mean the same span as every other stage. Before this existed each stage
 * addressed prose its own way, so an operation recorded against a bullet and a
 * finding raised against that bullet could not be joined without guessing.
 *
 * A segment is a *span of rendered prose* plus a stable location. It carries no
 * provenance and no claim IDs on purpose: the same function segments an
 * operator's approved baseline and a freshly tailored draft, and the baseline
 * must never be able to hand a claim ID to anything. See `editorial-baseline.js`.
 */

export const SEGMENT_SECTIONS = [
  "headline",
  "summary",
  "experience",
  "skills",
  "projects",
  "education",
  "certifications",
  "awards",
];

export function hashText(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

/**
 * Sentence splitting for a summary that carries no clause provenance.
 *
 * A tailored resume records `provenance.summary[].text` verbatim, and that is
 * always preferred, because it is the exact string the author mapped. This
 * fallback exists for an operator-supplied baseline, which is prose someone
 * approved rather than an artifact this pipeline produced.
 *
 * Abbreviations are held back so "e.g." does not become a sentence boundary and
 * silently split one approved sentence into two segments that then look like
 * two unexplained changes.
 */
const ABBREVIATIONS = new Set([
  "e.g", "i.e", "etc", "vs", "approx", "inc", "ltd", "co", "dr", "mr", "ms", "mrs", "st", "no",
]);

export function splitSentences(text) {
  const source = String(text || "").trim();
  if (!source) return [];
  const sentences = [];
  let current = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    current += character;
    if (character !== "." && character !== "!" && character !== "?") continue;

    const trailing = /([A-Za-z.]+)\.$/.exec(current);
    if (character === "." && trailing && ABBREVIATIONS.has(trailing[1].toLowerCase().replace(/\.$/, ""))) {
      continue;
    }
    // A decimal point inside a number is not a sentence end.
    if (character === "." && /\d\.$/.test(current) && /^\d/.test(source.slice(index + 1).trim())) {
      continue;
    }
    const next = source.slice(index + 1);
    if (next && !/^\s/.test(next)) continue;
    sentences.push(current.trim());
    current = "";
  }
  if (current.trim()) sentences.push(current.trim());
  return sentences;
}

function summarySentences(resume) {
  const mapped = resume?.provenance?.summary || [];
  if (mapped.length) {
    return mapped
      .slice()
      .sort((a, b) => (a.sentenceIndex ?? 0) - (b.sentenceIndex ?? 0))
      .map((entry) => String(entry.text || ""))
      .filter(Boolean);
  }
  return splitSentences(resume?.summary || "");
}

function segment({ location, section, kind, text, ...rest }) {
  const value = String(text ?? "");
  return { location, section, kind, text: value, hash: hashText(value), ...rest };
}

/**
 * Every span of a resume that a person reads, in document order.
 *
 * Order matters: `move` operations are judged against it, and the audit reports
 * repeated openings among *adjacent* bullets.
 */
export function segmentResume(resume) {
  const segments = [];

  if (resume?.ats_title) {
    segments.push(segment({
      location: "headline",
      section: "headline",
      kind: "headline",
      text: resume.ats_title,
    }));
  }

  summarySentences(resume).forEach((text, index) => {
    segments.push(segment({
      location: `summary.sentences[${index}]`,
      section: "summary",
      kind: "sentence",
      text,
      sentenceIndex: index,
    }));
  });

  (resume?.experience || []).forEach((role, roleIndex) => {
    (role.bullets || []).forEach((text, bulletIndex) => {
      segments.push(segment({
        location: `experience[${roleIndex}].bullets[${bulletIndex}]`,
        section: "experience",
        kind: "bullet",
        text,
        experienceId: role.id || "",
        experienceIndex: roleIndex,
        bulletIndex,
      }));
    });
  });

  for (const [field, tier] of [["skills_primary", "primary"], ["skills_secondary", "secondary"]]) {
    (resume?.[field] || []).forEach((text, index) => {
      segments.push(segment({
        location: `skills.${tier}[${index}]`,
        section: "skills",
        kind: "skill",
        text,
        tier,
      }));
    });
  }

  (resume?.projects || []).forEach((project, index) => {
    if (project.name) {
      segments.push(segment({
        location: `projects[${index}].name`,
        section: "projects",
        kind: "project_name",
        text: project.name,
        projectIndex: index,
      }));
    }
    if (project.description) {
      segments.push(segment({
        location: `projects[${index}].description`,
        section: "projects",
        kind: "project_description",
        text: project.description,
        projectIndex: index,
      }));
    }
    (project.highlights || []).forEach((text, highlightIndex) => {
      segments.push(segment({
        location: `projects[${index}].highlights[${highlightIndex}]`,
        section: "projects",
        kind: "project_highlight",
        text,
        projectIndex: index,
      }));
    });
  });

  (resume?.education || []).forEach((entry, index) => {
    segments.push(segment({
      location: `education[${index}]`,
      section: "education",
      kind: "education",
      text: [entry.degree, entry.school].filter(Boolean).join(" — "),
      educationIndex: index,
    }));
  });

  (resume?.certifications || []).forEach((entry, index) => {
    segments.push(segment({
      location: `certifications[${index}]`,
      section: "certifications",
      kind: "certification",
      text: [entry.name, entry.issuer].filter(Boolean).join(" — "),
      certificationIndex: index,
    }));
  });

  (resume?.awards_or_contributions || []).forEach((entry, index) => {
    segments.push(segment({
      location: `awards[${index}]`,
      section: "awards",
      kind: "award",
      text: [entry.title, entry.description].filter(Boolean).join(" — "),
      awardIndex: index,
    }));
  });

  return segments;
}

export function indexSegments(segments) {
  return new Map(segments.map((entry) => [entry.location, entry]));
}

/**
 * What actually changed between an approved baseline and a draft.
 *
 * Byte equality is the test, deliberately. "Preserve approved wording" is only
 * a guarantee if a whitespace-normalised comparison cannot quietly pass a
 * reworded sentence, and an operator who approved a semicolon approved that
 * semicolon.
 *
 * Locations are compared, not positions: moving a bullet from role 0 to role 1
 * is reported as a removal plus an addition, and the editorial plan is what
 * says those two are one `move`. Deciding that here would mean guessing intent
 * from text similarity, which is exactly the judgment the plan exists to record
 * explicitly.
 */
export function diffSegments(baselineSegments, revisedSegments) {
  const baseline = indexSegments(baselineSegments);
  const revised = indexSegments(revisedSegments);

  const unchanged = [];
  const modified = [];
  const removed = [];
  const added = [];

  for (const [location, before] of baseline) {
    const after = revised.get(location);
    if (!after) {
      removed.push({ location, section: before.section, before });
      continue;
    }
    if (after.hash === before.hash) unchanged.push({ location, section: before.section, before, after });
    else modified.push({ location, section: before.section, before, after });
  }
  for (const [location, after] of revised) {
    if (!baseline.has(location)) added.push({ location, section: after.section, after });
  }

  return {
    unchanged,
    modified,
    removed,
    added,
    // Every location an operation has to account for. An unchanged span needs
    // no operation; that is the whole point of a baseline.
    changedLocations: [...modified, ...removed, ...added].map((entry) => entry.location).sort(),
  };
}

const TOKEN = /[a-z0-9+#.]+/g;

export function significantTokens(text) {
  const stop = new Set([
    "a", "an", "and", "the", "to", "of", "for", "with", "by", "in", "on", "at", "from", "that",
    "this", "it", "as", "into", "across", "using", "was", "were", "is", "are", "be", "been",
  ]);
  return [...String(text || "").toLowerCase().matchAll(TOKEN)]
    .map((match) => match[0].replace(/\.$/, ""))
    .filter((token) => token.length > 1 && !stop.has(token));
}
