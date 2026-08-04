#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ZJobSearchReport } from "../schemas/job-search.js";
import { filterReportByCompany, renderJobSearchReport } from "../lib/job-search.js";

/**
 * Render a company-scoped sub-report from one or more reconciled candidates.json
 * files.
 *
 * Usage:
 *   node src/tools/report-company.js --company <name> --out <file.md> \
 *     <candidates.json> [more-candidates.json ...]
 *
 * Every posting for that company renders as a full card spanning all four
 * dispositions, ranked by evidence coverage, because the gate decides what is
 * ready to act on and not what the operator may consider.
 *
 * This is a view over committed reconciler output: scores, rationale, concerns,
 * gaps and claim citations are copied through untouched and nothing is
 * re-ranked by hand. Passing several candidates.json files renders one section
 * per run, so an incremental sweep observed on a later date stays bound to its
 * own observation window instead of being back-dated into an earlier run.
 */
function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const company = arg("--company");
const outPath = arg("--out");
const inputs = process.argv.slice(2).filter((a, i, all) => {
  if (a.startsWith("--")) return false;
  const prev = all[i - 1];
  return prev !== "--company" && prev !== "--out" && prev !== "--intro";
});

if (!company || !outPath || inputs.length === 0) {
  process.stderr.write(
    "Usage: node src/tools/report-company.js --company <name> --out <file.md> <candidates.json> [...]\n"
  );
  process.exit(1);
}

try {
  const sections = [];
  const totals = { act: 0, watch: 0, blocked: 0, no_fit: 0 };
  let scored = 0;

  for (const inPath of inputs) {
    const full = ZJobSearchReport.parse(JSON.parse(fs.readFileSync(inPath, "utf8")));
    const view = ZJobSearchReport.parse(filterReportByCompany(full, company));
    const count = view.candidates.length + view.excluded.length;
    if (count === 0) continue;
    scored += count;
    totals.act += view.candidates.length;
    for (const e of view.excluded) {
      totals[e.disposition] = (totals[e.disposition] || 0) + 1;
    }
    sections.push(
      renderJobSearchReport(view, {
        // Every req gets a card: a company-scoped report the operator asked for
        // by name should not truncate at ten or hide the no-fit ones.
        cardLimit: Number.POSITIVE_INFINITY,
        includeNoFit: true,
        title: `## Run ${view.runDate} — ${count} ${company} posting${count === 1 ? "" : "s"}`,
      })
    );
  }

  if (sections.length === 0) {
    process.stderr.write(`report-company: no ${company} postings found in ${inputs.join(", ")}\n`);
    process.exit(1);
  }

  const header = [
    `# ${company} — focused sub-report for ${
      ZJobSearchReport.parse(JSON.parse(fs.readFileSync(inputs[0], "utf8"))).persona
    }`,
    "",
    `${scored} ${company} posting${scored === 1 ? "" : "s"} scored across ${sections.length} run${
      sections.length === 1 ? "" : "s"
    } — ${totals.act} to act on, ${totals.watch} to watch, ${totals.blocked} blocked by one gate, ${
      totals.no_fit
    } not a fit.`,
    "",
    "Ranked by evidence coverage across **every** disposition. The consensus gate " +
      "decides what is ready to act on; it does not decide what you may consider, " +
      "so a strong role held up by one unpublished salary outranks a weak one that " +
      "happened to pass.",
    "",
    "`evidence coverage` is how much of what the posting asks for your verified " +
      "claims can back. It is not a hiring probability — that depends on the other " +
      "applicants, which no run can see.",
    "",
    "Scores, rationale, concerns and claim citations below are copied verbatim from " +
      "the reconciler output. Nothing here was re-scored or re-ranked by hand.",
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, header + sections.join("\n"));
  process.stdout.write(`${outPath}\n`);
  process.stdout.write(
    `${scored} scored · ${totals.act} act · ${totals.watch} watch · ${totals.blocked} blocked · ${totals.no_fit} no_fit\n`
  );
} catch (error) {
  process.stderr.write(`report-company error: ${error.message}\n`);
  process.exit(1);
}
