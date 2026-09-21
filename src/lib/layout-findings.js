import { balanceSkillLines } from "./skill-layout.js";

// Layout quality is *reported* here, never repaired.
//
// v7 removed this tool's ability to refuse: release.json is review_ready or
// generation_failed, and every concern is a finding handed back to the
// operator. A layout gate that blocked would walk that back. So every issue
// this module produces is a warning, and `valid` is computed from errors only.
//
// The asymmetry with src/lib/skill-layout.js is deliberate and worth keeping
// straight. Repartitioning a skill list is arithmetic over content that already
// exists, so it is safe to *do*. Reflowing sections to fill a page means
// deciding what to cut or expand, which is an editorial judgement about the
// person's history — so it is only ever *said*.

const FALLBACK_POLICY = { minFinalPageFillPercent: 55, maxSkillsPerLine: 7 };

/**
 * Turn measured layout into findings.
 *
 * Every finding carries an action. A negative finding with no route attached is
 * unfinished work, not a result.
 *
 * @param {{
 *   layout: { pageCount?: number, pageFillPercent?: number[], finalPageFillPercent?: number },
 *   skills?: string[] | Record<string, string[]> | string,
 *   profile?: object,
 *   skillLines?: string[]
 * }} input
 * @returns {{ layout: object, issues: Array<{severity: string, code: string, field: string, detail: string, action: string}> }}
 */
export function layoutFindings({ layout, skills = [], profile = null, skillLines = null }) {
  const issues = [];
  const policy = profile?.layout ?? FALLBACK_POLICY;

  const pageCount = Number(layout?.pageCount) || 0;
  const finalFill = Number(layout?.finalPageFillPercent);
  const hasFill = Number.isFinite(finalFill);

  // A single page cannot be "badly distributed" — there is no distribution.
  if (pageCount > 1 && hasFill && finalFill < policy.minFinalPageFillPercent) {
    issues.push({
      severity: "warning",
      code: "final_page_underfilled",
      field: `page[${pageCount}]`,
      detail:
        `Page ${pageCount} is ${finalFill}% full, below the ${policy.minFinalPageFillPercent}% ` +
        "this style expects, so the page break reads as accidental rather than deliberate.",
      action:
        "Decide whether the content belongs on one page, or pick a style whose spacing " +
        "distributes it deliberately. Labora does not reflow sections: choosing what to cut " +
        "or expand is a content decision, and it is yours.",
    });
  }

  const lines = Array.isArray(skillLines)
    ? skillLines
    : balanceSkillLines(normalizeSkillInput(skills), { maxPerLine: policy.maxSkillsPerLine });

  let orphanSkillRows = 0;
  if (lines.length > 1) {
    const counts = lines.map((line) => line.split(", ").length);
    if (Math.min(...counts) < 2) {
      orphanSkillRows = counts.filter((count) => count < 2).length;
      issues.push({
        severity: "warning",
        code: "orphan_skill_row",
        field: "skills",
        detail: `Skills render as ${counts.join(" / ")}, stranding a row with a single item.`,
        action:
          "Report this as a partitioning defect in src/lib/skill-layout.js. The balancer " +
          "constrains every run to at least two items, so reaching this state means the " +
          "constraint was bypassed rather than that the skill list is unusual.",
      });
    }
  }

  return {
    layout: {
      pageCount,
      pageFillPercent: Array.isArray(layout?.pageFillPercent) ? layout.pageFillPercent : [],
      finalPageFillPercent: hasFill ? finalFill : null,
      orphanSkillRows,
    },
    issues,
  };
}

/** Accept the same shapes the renderers accept, so a caller cannot pass the wrong one. */
function normalizeSkillInput(skills) {
  if (Array.isArray(skills)) return skills;
  if (typeof skills === "string") return skills ? [skills] : [];
  if (skills && typeof skills === "object") return Object.values(skills).flat();
  return [];
}
