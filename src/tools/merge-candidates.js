#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  reconcileCandidates,
  applySeenLedger,
  validateDiscoveryReport,
  validateFitReportGrounding,
  validateScoutReportsAgainstDiscovery,
} from "../lib/job-search.js";
import {
  ZDiscoveryReport,
  ZScoutReport,
  ZSearchPreferences,
  ZJobSearchReport,
  ZSeenLedger,
} from "../schemas/job-search.js";
import { ZClaimLedger } from "../schemas/provenance.js";

/**
 * Reconcile scout reports into candidates.json.
 *
 * Usage:
 *   node src/tools/merge-candidates.js <run-dir> --prefs <search-preferences.json> \
 *     [--claims <claims.json>] \
 *     [--persona <name>] [--min-agreement 2] [--threshold 70] [--fit-floor 60]
 *
 * Reads every raw/scout-*.json under <run-dir>. Writes <run-dir>/candidates.json.
 */
/** Excluded is not one bucket: the summary line has to say what to do next. */
const countDisposition = (report, disposition) =>
  report.excluded.filter((e) => e.disposition === disposition).length;

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const runDir = process.argv[2];
const prefsPath = arg("--prefs");
if (!runDir || !prefsPath) {
  process.stderr.write(
    "Usage: node src/tools/merge-candidates.js <run-dir> --prefs <search-preferences.json> [--claims <claims.json>] [--persona name] [--min-agreement 2] [--threshold 70] [--fit-floor 60] [--seen <seen.json>] [--suppress-seen]\n"
  );
  process.exit(1);
}

try {
  const prefsRaw = fs.readFileSync(prefsPath, "utf8");
  const prefs = ZSearchPreferences.parse(JSON.parse(prefsRaw));
  const preferencesHash = crypto.createHash("sha256").update(prefsRaw).digest("hex");
  const claimsPath = arg("--claims", path.join(path.dirname(prefsPath), "claims.json"));
  const claims = ZClaimLedger.parse(JSON.parse(fs.readFileSync(claimsPath, "utf8")));
  const runDate = path.basename(path.resolve(runDir));

  const rawDir = path.join(runDir, "raw");
  const discoveryPath = path.join(rawDir, "discovered.json");
  if (!fs.existsSync(discoveryPath)) {
    process.stderr.write(`merge-candidates error: missing ${discoveryPath}\n`);
    process.exit(1);
  }
  const discovery = ZDiscoveryReport.parse(
    JSON.parse(fs.readFileSync(discoveryPath, "utf8"))
  );
  validateDiscoveryReport(discovery, { runDate, timeZone: prefs.timezone });
  const scoutFiles = fs.existsSync(rawDir)
    ? fs.readdirSync(rawDir).filter((f) => /^scout-.*\.json$/.test(f)).sort()
    : [];
  if (scoutFiles.length === 0) {
    process.stderr.write(`merge-candidates error: no raw/scout-*.json under ${runDir}\n`);
    process.exit(1);
  }

  const reports = scoutFiles.map((f) =>
    ZScoutReport.parse(JSON.parse(fs.readFileSync(path.join(rawDir, f), "utf8")))
  );
  validateScoutReportsAgainstDiscovery(discovery, reports, {
    runDate,
    timeZone: prefs.timezone,
  });

  const minAgreement = Number(arg("--min-agreement", "2"));
  const consensusThreshold = Number(arg("--threshold", "70"));
  const fitFloor = Number(arg("--fit-floor", "60"));
  const persona = arg("--persona", reports[0]?.persona || "unknown");
  validateFitReportGrounding(reports, claims, prefs, { fitFloor });

  const { candidates, excluded } = reconcileCandidates(reports, {
    minAgreement,
    consensusThreshold,
    fitFloor,
    avoid: prefs.avoid,
    targetCompanies: prefs.targetCompanies,
  });

  const report = ZJobSearchReport.parse({
    schemaVersion: "1.0",
    persona,
    runDate,
    preferencesHash,
    sources: [...new Set(reports.flatMap((r) => r.sources))],
    scouts: reports.map((r) => ({
      angle: r.angle,
      model: r.metadata.model,
      candidateCount: r.candidates.length,
    })),
    minAgreement,
    consensusThreshold,
    fitFloor,
    candidates,
    excluded,
    coverage: discovery.coverage,
  });

  const seenPath = arg("--seen");
  const suppressSeen = hasFlag("--suppress-seen");
  let finalReport = report;
  if (seenPath) {
    const ledger = fs.existsSync(seenPath)
      ? ZSeenLedger.parse(JSON.parse(fs.readFileSync(seenPath, "utf8")))
      : null;
    const applied = applySeenLedger({
      report,
      ledger,
      runDate: report.runDate,
      suppressSeen,
    });
    finalReport = ZJobSearchReport.parse(applied.report);
    const ledgerOut = ZSeenLedger.parse(applied.ledger);
    fs.mkdirSync(path.dirname(seenPath), { recursive: true });
    fs.writeFileSync(seenPath, JSON.stringify(ledgerOut, null, 2) + "\n");
  }

  const outPath = path.join(runDir, "candidates.json");
  fs.writeFileSync(outPath, JSON.stringify(finalReport, null, 2) + "\n");
  const newLeads = finalReport.newLeadCount;
  process.stdout.write(
    `${outPath}\n${finalReport.candidates.length} to act on` +
      (newLeads != null ? ` (${newLeads} new)` : "") +
      `, ${countDisposition(finalReport, "watch")} to watch` +
      `, ${countDisposition(finalReport, "blocked")} blocked` +
      `, ${countDisposition(finalReport, "no_fit")} no fit` +
      ` from ${reports.length} scout(s)\n`
  );
} catch (error) {
  process.stderr.write(`merge-candidates error: ${error.message}\n`);
  process.exit(1);
}
