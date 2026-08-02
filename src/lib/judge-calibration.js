/**
 * Deterministic judge-calibration analytics.
 *
 * The three judges (ATS, engineer, HR) are independent LLM sub-agents. Their
 * coarse verdicts drive the release gate, but a single run reveals nothing about
 * whether a judge grades consistently, whether a swapped model shifts the bar, or
 * whether the three actually agree. This module aggregates historical judge
 * outputs into distributions, per-model breakdowns, month-over-month drift, and
 * cross-judge agreement so drift can be caught before it silently changes who
 * gets marked send_ready.
 *
 * Pure and deterministic — the caller collects judge JSON from disk and hands it
 * in as records; nothing here does I/O.
 */

const JUDGES = ["ats", "engineer", "hr"];

/** Coarse hire signal per judge verdict: +1 positive, -1 negative, 0 neutral. */
const SIGN = {
  ats: { pass: 1, marginal: 0, fail: -1 },
  engineer: { advance_to_onsite: 1, phone_screen: 1, lean_no: -1, no: -1 },
  hr: { strong_advance: 1, advance: 1, review: 0, decline: -1 },
};

const VERDICT_FIELD = { ats: "verdict", engineer: "verdict", hr: "screenRecommendation" };

function verdictOf(judge, output) {
  return output?.[VERDICT_FIELD[judge]] ?? null;
}

function signOf(judge, output) {
  const verdict = verdictOf(judge, output);
  return SIGN[judge]?.[verdict] ?? 0;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreStats(scores) {
  if (!scores.length) {
    return { count: 0, min: null, max: null, mean: null, median: null, stdev: null };
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length;
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: round(mean),
    median: round(median),
    stdev: round(Math.sqrt(variance)),
  };
}

function tally(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function monthOf(isoTimestamp) {
  const value = String(isoTimestamp || "");
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "unknown";
}

function pearson(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return round(num / Math.sqrt(dx * dy), 2);
}

/**
 * @param {Array<{ application: string, persona?: string, judge: "ats"|"engineer"|"hr", output: object }>} records
 */
export function calibrateJudges(records) {
  const byJudge = Object.fromEntries(JUDGES.map((judge) => [judge, []]));
  for (const record of records) {
    if (byJudge[record.judge]) byJudge[record.judge].push(record);
  }

  const judges = {};
  for (const judge of JUDGES) {
    const rows = byJudge[judge];
    const scores = rows.map((r) => r.output?.score).filter((s) => typeof s === "number");
    const verdicts = rows.map((r) => verdictOf(judge, r.output)).filter(Boolean);

    const byModel = {};
    for (const row of rows) {
      const model = row.output?.metadata?.model || "unknown";
      (byModel[model] ||= []).push(row);
    }
    const models = Object.fromEntries(
      Object.entries(byModel).map(([model, modelRows]) => [
        model,
        {
          ...scoreStats(modelRows.map((r) => r.output?.score).filter((s) => typeof s === "number")),
          verdicts: tally(modelRows.map((r) => verdictOf(judge, r.output)).filter(Boolean)),
        },
      ])
    );

    const byPrompt = {};
    for (const row of rows) {
      const prompt = row.output?.metadata?.promptHash || "unknown";
      (byPrompt[prompt] ||= []).push(row);
    }
    const promptHashes = Object.fromEntries(
      Object.entries(byPrompt).map(([promptHash, promptRows]) => [
        promptHash,
        {
          ...scoreStats(promptRows.map((r) => r.output?.score).filter((s) => typeof s === "number")),
          verdicts: tally(promptRows.map((r) => verdictOf(judge, r.output)).filter(Boolean)),
        },
      ])
    );

    const byMonth = {};
    for (const row of rows) {
      const month = monthOf(row.output?.metadata?.evaluatedAt);
      (byMonth[month] ||= []).push(row.output?.score);
    }
    const drift = Object.fromEntries(
      Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, monthScores]) => [
          month,
          scoreStats(monthScores.filter((s) => typeof s === "number")),
        ])
    );

    judges[judge] = {
      sampleCount: rows.length,
      verdictDistribution: tally(verdicts),
      scoreStats: scoreStats(scores),
      byModel: models,
      byPromptHash: promptHashes,
      drift,
    };
  }

  const applications = new Map();
  for (const record of records) {
    const entry = applications.get(record.application) || {};
    entry[record.judge] = record.output;
    applications.set(record.application, entry);
  }

  let unanimousPositive = 0;
  let unanimousNegative = 0;
  let split = 0;
  let complete = 0;
  const scorePairs = { ats_engineer: [], ats_hr: [], engineer_hr: [] };
  for (const entry of applications.values()) {
    if (!JUDGES.every((judge) => entry[judge])) continue;
    complete += 1;
    const signs = JUDGES.map((judge) => signOf(judge, entry[judge]));
    if (signs.every((s) => s > 0)) unanimousPositive += 1;
    else if (signs.every((s) => s < 0)) unanimousNegative += 1;
    else split += 1;
    scorePairs.ats_engineer.push([entry.ats.score, entry.engineer.score]);
    scorePairs.ats_hr.push([entry.ats.score, entry.hr.score]);
    scorePairs.engineer_hr.push([entry.engineer.score, entry.hr.score]);
  }

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    sampleCount: records.length,
    applicationCount: applications.size,
    judges,
    agreement: {
      completeApplications: complete,
      unanimousPositive,
      unanimousNegative,
      split,
      unanimousRate: complete ? round((unanimousPositive + unanimousNegative) / complete, 2) : null,
      scoreCorrelation: {
        ats_engineer: pearson(scorePairs.ats_engineer),
        ats_hr: pearson(scorePairs.ats_hr),
        engineer_hr: pearson(scorePairs.engineer_hr),
      },
    },
  };
}
