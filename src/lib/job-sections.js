/**
 * Section definitions for parsing job descriptions.
 * Each section has a label, weight (for scoring), and cue phrases that identify it.
 */
export const SECTION_DEFS = [
  { label: "requirements", weight: 3, cues: [
    "essential skills", "what you need", "need to succeed", "requirements",
    "qualifications", "minimum qualifications", "required", "must have", "must-have",
    "ideal candidate", "you should have", "you'll need", "basic qualifications",
    "key requirements", "successful in this role",
  ]},
  { label: "responsibilities", weight: 2, cues: [
    "responsibilities", "responsibility", "what you'll do", "what you will do",
    "how you will make an impact", "role overview", "key duties",
  ]},
  { label: "nice_to_have", weight: 1.5, cues: [
    "desired skills", "desired experience", "nice to have", "nice-to-have",
    "preferred qualifications", "bonus skills", "a plus",
  ]},
  { label: "about", weight: 0.5, cues: [
    "about the", "about us", "who we are", "company overview", "about the job",
  ]},
  { label: "compensation", weight: 0, cues: [
    "compensation", "pay range", "salary", "benefits", "what we offer",
    "what you'll receive", "perks",
  ]},
];

/**
 * Parse job description text into labeled sections.
 * @param {string} text - Raw job description text
 * @returns {Array<{ label: string, weight: number, lines: string[] }>}
 */
export function parseSections(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const sections = [];
  let current = { label: "about", weight: 0.5, lines: [] };

  for (const line of lines) {
    const lower = line.toLowerCase();
    const isBullet = /^[-*•]\s|^\d+[.)]\s/.test(line);
    const isMarkdownHeading = /^#{1,6}\s+\S/.test(line);
    const headingText = lower.replace(/^#{1,6}\s*/, "").replace(/:$/, "").trim();
    const isHeadingCandidate = !isBullet && (isMarkdownHeading || line.length < 80 || lower.endsWith(":"));
    if (isHeadingCandidate) {
      const match = SECTION_DEFS.flatMap((definition) =>
        definition.cues
          .filter((cue) => headingText === cue || headingText.includes(cue))
          .map((cue) => ({
            ...definition,
            exact: headingText === cue,
            cueLength: cue.length,
          }))
      ).sort((a, b) => Number(b.exact) - Number(a.exact) || b.cueLength - a.cueLength)[0];
      if (match) {
        if (current.lines.length) sections.push(current);
        current = { label: match.label, weight: match.weight, lines: [] };
        continue;
      }
    }
    current.lines.push(line);
  }
  if (current.lines.length) sections.push(current);
  return sections;
}

/**
 * Group parsed sections by label.
 * @param {Array<{ label: string, weight: number, lines: string[] }>} sections
 * @returns {Object<string, { weight: number, text: string, lines: string[] }>}
 */
export function groupByLabel(sections) {
  const byLabel = {};
  for (const s of sections) {
    if (!byLabel[s.label]) byLabel[s.label] = { weight: s.weight, text: "", lines: [] };
    byLabel[s.label].text += s.lines.join("\n") + "\n";
    byLabel[s.label].lines.push(...s.lines);
  }
  return byLabel;
}
