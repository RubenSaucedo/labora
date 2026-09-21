// Skill lines are partitioned here and nowhere else. The DOCX, HTML and
// Markdown renderers all call through this module, so a grouping decision is
// made once and the three artifacts cannot disagree. That shared call is what
// "DOCX/PDF parity" actually means: Word repaginates a DOCX when it opens the
// file, so the renderers can never be held to the same *page* breaks — only to
// the same *grouping* decisions, which is what this module fixes in place.
//
// Dependency-free on purpose: run-state and degraded advisory mode have to keep
// working on a machine with nothing installed, the same split that already
// separates src/lib/resume-style.js from src/schemas/resume-style.js.

const SEPARATOR = ", ";
const MIN_ITEMS_PER_LINE = 2;
const MIN_MAX_PER_LINE = 3;

/**
 * Width of the run items[i..j-1] as it will actually be printed, including the
 * separators between them.
 *
 * Character count, not item count, is the measure. Balancing
 * ["React", "Model Context Protocol", "Node.js"] by count still yields visibly
 * ragged lines, because skill names differ in length by a factor of four.
 * Character count is a deterministic proxy for rendered width that needs no
 * font metrics — the DOCX path has none, and making grouping depend on
 * installed fonts would break both determinism and renderer parity.
 */
function runWidth(prefixLengths, i, j) {
  return prefixLengths[j] - prefixLengths[i] + SEPARATOR.length * (j - i - 1);
}

/**
 * Partition into exactly `lineCount` contiguous, order-preserving runs whose
 * longest rendered width is minimal, subject to every run holding at least
 * `minItems` items.
 *
 * The minimum is a *constraint*, not an emergent property, and that distinction
 * is the whole point of this function. Minimising the longest line alone does
 * not prevent an orphan: given seven one-character skills and one very long
 * eighth, the partition 7/1 genuinely *is* the minimiser, because every
 * alternative forces the long item to share a line and produce a longer one.
 * Leaving the no-orphan property to the objective function would therefore
 * reproduce the exact defect this module exists to remove.
 *
 * @returns {Array<[number, number]> | null} run bounds, or null if infeasible
 */
function partitionIndices(items, lineCount, maxPerLine, minItems) {
  const n = items.length;
  const prefixLengths = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i += 1) prefixLengths[i + 1] = prefixLengths[i] + items[i].length;

  const INFEASIBLE = Number.POSITIVE_INFINITY;

  // best[r][i] = minimal achievable longest-run width for splitting items
  // i..n-1 into exactly r runs. cut[r][i] records where the chosen run ends.
  const best = Array.from({ length: lineCount + 1 }, () => new Array(n + 1).fill(INFEASIBLE));
  const cut = Array.from({ length: lineCount + 1 }, () => new Array(n + 1).fill(-1));
  best[0][n] = 0;

  for (let r = 1; r <= lineCount; r += 1) {
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let length = minItems; length <= maxPerLine; length += 1) {
        const j = i + length;
        if (j > n) break;
        const remainder = best[r - 1][j];
        if (remainder === INFEASIBLE) continue;
        const candidate = Math.max(runWidth(prefixLengths, i, j), remainder);
        // Strict `<` keeps the first (shortest) run on a tie, so the split is a
        // pure function of the input and repeated renders cannot drift.
        if (candidate < best[r][i]) {
          best[r][i] = candidate;
          cut[r][i] = j;
        }
      }
    }
  }

  if (best[lineCount][0] === INFEASIBLE) return null;

  const bounds = [];
  let start = 0;
  for (let r = lineCount; r >= 1; r -= 1) {
    const end = cut[r][start];
    bounds.push([start, end]);
    start = end;
  }
  return bounds;
}

/**
 * Group skills into balanced, order-preserving lines.
 *
 * Nothing here may rewrite, omit, reorder or invent a skill: the output lines
 * concatenate back to the input exactly. Layout is arithmetic over a list that
 * already exists, which is precisely why balancing is allowed to change the
 * document while page-fill is only ever reported.
 *
 * @param {string[]} items
 * @param {{ maxPerLine?: number }} [options]
 * @returns {string[]} rendered lines
 */
export function balanceSkillLines(items, { maxPerLine = 7 } = {}) {
  if (!Array.isArray(items)) return [];
  const list = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (list.length === 0) return [];

  if (!Number.isInteger(maxPerLine) || maxPerLine < MIN_MAX_PER_LINE) {
    throw new Error(
      `maxPerLine must be an integer >= ${MIN_MAX_PER_LINE}; received ${maxPerLine}. ` +
      "Below that a balanced partition cannot guarantee two items per line, so the " +
      "configuration would silently reintroduce orphan rows."
    );
  }

  // An entry that already carries its own "Category: a, b" label is a complete
  // line. Joining two of those with ", " would read as one run-on category.
  if (list.some((entry) => entry.includes(": "))) return list;

  const lineCount = Math.ceil(list.length / maxPerLine);
  if (lineCount <= 1) return [list.join(SEPARATOR)];

  // lineCount = ceil(n / maxPerLine) implies n >= (lineCount - 1) * maxPerLine + 1,
  // which is at least 2 * lineCount whenever maxPerLine >= 3. The guard is kept
  // so a future caller cannot turn an arithmetic surprise into a crashed render.
  const minItems = lineCount * MIN_ITEMS_PER_LINE <= list.length ? MIN_ITEMS_PER_LINE : 1;
  const bounds = partitionIndices(list, lineCount, maxPerLine, minItems);

  if (!bounds) {
    const lines = [];
    for (let i = 0; i < list.length; i += maxPerLine) {
      lines.push(list.slice(i, i + maxPerLine).join(SEPARATOR));
    }
    return lines;
  }

  return bounds.map(([start, end]) => list.slice(start, end).join(SEPARATOR));
}
