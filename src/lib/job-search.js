import crypto from "node:crypto";

const ANGLES = ["fit", "market", "growth"];

/**
 * Canonical, stable identity for a job across sources. Prefer normalized
 * company|title|location because aggregators and official career sites use
 * different URLs for the same posting; use URL only when identity fields are
 * incomplete.
 */
export function canonicalJobId(candidate) {
  const identity = ["company", "title", "location"]
    .map((field) => (candidate[field] || "").trim().toLowerCase().replace(/\s+/g, " "));
  if (identity[0] && identity[1]) {
    return sha256(`id:${identity.join("|")}`).slice(0, 16);
  }
  const url = (candidate.url || "").trim();
  if (url) {
    try {
      const u = new URL(url);
      const host = u.host.toLowerCase().replace(/^www\./, "");
      const path = u.pathname.replace(/\/+$/, "");
      return sha256(`url:${host}${path}`).slice(0, 16);
    } catch {
      // fall through to identity fields
    }
  }
  return sha256(`id:${identity.join("|")}`).slice(0, 16);
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function normalizePostingText(text) {
  return String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function postingHash(text) {
  return sha256(normalizePostingText(text));
}

function dateInTimeZone(timestamp, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    throw new Error(`Invalid search timezone "${timeZone}".`);
  }
}

function validateEvaluationTime(report, label, runDate, timeZone) {
  const evaluatedAtValue = report.metadata?.evaluatedAt;
  if (dateInTimeZone(evaluatedAtValue, timeZone) !== runDate) {
    throw new Error(`${label} evaluatedAt must match run date ${runDate}.`);
  }
  const generatedAt = Date.parse(report.generatedAt);
  const evaluatedAt = Date.parse(evaluatedAtValue);
  if (evaluatedAt > generatedAt || generatedAt - evaluatedAt > 24 * 60 * 60 * 1000) {
    throw new Error(`${label} evaluatedAt is outside the 24-hour generation window.`);
  }
}

export function validateDiscoveryReport(
  discoveryReport,
  { runDate, timeZone = "UTC" } = {}
) {
  if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    throw new Error("Discovery validation requires a YYYY-MM-DD run date.");
  }
  if (dateInTimeZone(discoveryReport.generatedAt, timeZone) !== runDate) {
    throw new Error(
      `Discovery generatedAt must match run date ${runDate}; received ${discoveryReport.generatedAt}.`
    );
  }
  validateEvaluationTime(discoveryReport, "Discovery", runDate, timeZone);
  const generatedAt = Date.parse(discoveryReport.generatedAt);
  const jobIds = new Set();
  for (const job of discoveryReport.jobs || []) {
    if (jobIds.has(job.jobId)) {
      throw new Error(`Discovery contains duplicate jobId "${job.jobId}".`);
    }
    jobIds.add(job.jobId);
    const expectedJobId = canonicalJobId(job);
    if (job.jobId !== expectedJobId) {
      throw new Error(
        `Discovery jobId mismatch for "${job.jobId}"; expected "${expectedJobId}".`
      );
    }
    const expectedHash = postingHash(job.postingText);
    if (job.postingHash !== expectedHash) {
      throw new Error(`Discovery postingHash mismatch for "${job.jobId}".`);
    }
    const observedAt = Date.parse(job.observedAt);
    if (dateInTimeZone(job.observedAt, timeZone) !== runDate) {
      throw new Error(
        `Discovery observation for "${job.jobId}" must match run date ${runDate}.`
      );
    }
    if (observedAt > generatedAt || generatedAt - observedAt > 24 * 60 * 60 * 1000) {
      throw new Error(
        `Discovery observation for "${job.jobId}" is outside the 24-hour run window.`
      );
    }
  }
  return true;
}

function preferenceEvidence(preferences) {
  return [
    ...(preferences.targetTitles || []),
    ...(preferences.targetLevels || []),
    ...(preferences.targetCompanies || []),
    ...(preferences.locations || []),
    ...(preferences.mustHaves || []),
    ...(preferences.goals || []),
    preferences.remotePreference,
    ...(preferences.minCompensation == null ? [] : ["minCompensation"]),
  ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
}

export function validateFitReportGrounding(
  scoutReports,
  claimLedger,
  preferences,
  { fitFloor = 60 } = {}
) {
  const fitReport = scoutReports.find((report) => report.angle === "fit");
  if (!fitReport) throw new Error("Fit grounding validation requires a fit scout report.");

  const verifiedClaims = new Set(
    (claimLedger.claims || [])
      .filter((claim) => claim.status === "verified")
      .map((claim) => claim.id)
  );
  const validPreferences = new Set(preferenceEvidence(preferences));

  for (const report of scoutReports) {
    for (const candidate of report.candidates) {
      const unknownClaims = candidate.matchedClaims.filter((id) => !verifiedClaims.has(id));
      if (unknownClaims.length) {
        throw new Error(
          `${report.angle} scout "${candidate.jobId}" cites unverified or unknown claims: ${unknownClaims.join(", ")}.`
        );
      }
      const unknownPreferences = candidate.matchedPreferences.filter(
        (value) => !validPreferences.has(String(value).trim().toLowerCase())
      );
      if (unknownPreferences.length) {
        throw new Error(
          `${report.angle} scout "${candidate.jobId}" cites unknown preferences: ${unknownPreferences.join(", ")}.`
        );
      }
    }
  }
  for (const candidate of fitReport.candidates) {
    if (
      candidate.score >= fitFloor &&
      (!candidate.matchedClaims.length || !candidate.matchedPreferences.length)
    ) {
      throw new Error(
        `Fit scout "${candidate.jobId}" scored ${candidate.score} but lacks both verified claim and preference grounding.`
      );
    }
  }
  return true;
}

function isAvoided(candidate, avoid) {
  if (!avoid || avoid.length === 0) return false;
  const haystack = `${candidate.company} ${candidate.title}`.toLowerCase();
  return avoid.some((term) => term && haystack.includes(term.toLowerCase()));
}

function recommendationFor(agreementCount, consensusScore, minAgreement) {
  if (agreementCount >= 3 && consensusScore >= 80) return "strong_lead";
  if (agreementCount >= minAgreement && consensusScore >= 70) return "lead";
  if (consensusScore >= 60) return "stretch";
  return "watch";
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export function validateScoutReportsAgainstDiscovery(
  discoveryReport,
  scoutReports,
  { runDate, timeZone = "UTC" } = {}
) {
  const expectedAngles = new Set(ANGLES);
  const actualAngles = new Set(scoutReports.map((report) => report.angle));
  const missingAngles = ANGLES.filter((angle) => !actualAngles.has(angle));
  const duplicateAngles = ANGLES.filter((angle) =>
    scoutReports.filter((report) => report.angle === angle).length > 1
  );
  if (missingAngles.length || duplicateAngles.length || actualAngles.size !== expectedAngles.size) {
    throw new Error(
      `Scout reports must contain exactly fit, market, and growth; missing=${missingAngles.join(",") || "none"}, duplicate=${duplicateAngles.join(",") || "none"}.`
    );
  }

  const discovered = new Map(
    (discoveryReport.jobs || [])
      .filter((job) => job.status !== "closed")
      .map((job) => [job.jobId, job])
  );
  const identityFields = [
    "title",
    "company",
    "location",
    "url",
    "officialUrl",
    "postedDate",
    "observedAt",
    "postingHash",
    "status",
    "remote",
    "compensation",
    "source",
  ];

  for (const report of scoutReports) {
    if (runDate) {
      if (dateInTimeZone(report.generatedAt, timeZone) !== runDate) {
        throw new Error(
          `${report.angle} scout generatedAt must match run date ${runDate}.`
        );
      }
      const reportTime = Date.parse(report.generatedAt);
      const discoveryTime = Date.parse(discoveryReport.generatedAt);
      if (
        reportTime < discoveryTime ||
        reportTime - discoveryTime > 24 * 60 * 60 * 1000
      ) {
        throw new Error(
          `${report.angle} scout generatedAt is outside the 24-hour discovery window.`
        );
      }
      validateEvaluationTime(report, `${report.angle} scout`, runDate, timeZone);
    }
    const candidates = new Map();
    for (const candidate of report.candidates) {
      if (candidates.has(candidate.jobId)) {
        throw new Error(`${report.angle} scout scored job "${candidate.jobId}" more than once.`);
      }
      candidates.set(candidate.jobId, candidate);
    }
    const missing = [...discovered.keys()].filter((jobId) => !candidates.has(jobId));
    const extra = [...candidates.keys()].filter((jobId) => !discovered.has(jobId));
    if (missing.length || extra.length) {
      throw new Error(
        `${report.angle} scout coverage differs from discovered jobs; missing=${missing.join(",") || "none"}, extra=${extra.join(",") || "none"}.`
      );
    }
    for (const [jobId, job] of discovered) {
      const candidate = candidates.get(jobId);
      const changed = identityFields.filter((field) =>
        JSON.stringify(candidate[field] ?? null) !== JSON.stringify(job[field] ?? null)
      );
      if (candidate.angle !== report.angle) changed.push("angle");
      if (changed.length) {
        throw new Error(
          `${report.angle} scout changed discovered identity for "${jobId}": ${changed.join(", ")}.`
        );
      }
    }
  }
  return true;
}

/**
 * Reconcile independent scout reports into a single ranked consensus list.
 *
 * A job is promoted to an application lead only when at least `minAgreement`
 * distinct scout angles pooled it AND its consensus score clears `threshold`
 * AND it is not in the persona's avoid list. Everything else is surfaced in
 * `excluded` with a reason so the run stays auditable.
 *
 * Pure and deterministic — no I/O, no network. Scores come from the scouts;
 * this function only aggregates and gates.
 */
/** Company names vary in punctuation and suffix across sources ("Docker, Inc"). */
function isTargetCompany(company, targetCompanies) {
  const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const target = norm(company);
  if (!target) return false;
  return targetCompanies.some((t) => {
    const candidate = norm(t);
    return candidate && (target === candidate || target.startsWith(candidate));
  });
}

/** The angle dragging a consensus score down, so the shortfall is attributable. */
function weakestAngle(scores) {
  const present = ANGLES.filter((a) => scores[a] !== null);
  if (present.length === 0) return "an unscored angle";
  return present.reduce((low, a) => (scores[a] < scores[low] ? a : low), present[0]);
}

export function reconcileCandidates(scoutReports, options = {}) {
  const minAgreement = options.minAgreement ?? 2;
  const threshold = options.consensusThreshold ?? 70;
  const fitFloor = options.fitFloor ?? 60;
  const avoid = options.avoid ?? [];
  const targetCompanies = options.targetCompanies ?? [];

  const byJob = new Map();
  for (const report of scoutReports) {
    for (const cand of report.candidates) {
      const jobId = cand.jobId || canonicalJobId(cand);
      if (!byJob.has(jobId)) byJob.set(jobId, []);
      byJob.get(jobId).push({ ...cand, angle: cand.angle ?? report.angle });
    }
  }

  const candidates = [];
  const excluded = [];

  for (const [jobId, entries] of byJob) {
    const angles = uniq(entries.map((e) => e.angle));
    const agreementCount = angles.length;
    const scores = { fit: null, market: null, growth: null };
    for (const angle of ANGLES) {
      const forAngle = entries.filter((e) => e.angle === angle);
      if (forAngle.length > 0) {
        scores[angle] = Math.max(...forAngle.map((e) => e.score));
      }
    }
    const present = ANGLES.map((a) => scores[a]).filter((s) => s !== null);
    const consensusScore = present.length
      ? Math.round(present.reduce((a, b) => a + b, 0) / present.length)
      : 0;

    const base = entries[0];
    const merged = {
      jobId,
      title: base.title,
      company: base.company,
      location: base.location || "",
      url: base.url || "",
      officialUrl: entries.map((e) => e.officialUrl).find(Boolean) || "",
      remote: base.remote || "any",
      compensation: entries.map((e) => e.compensation).find((c) => c) ?? null,
      postedDate: entries.map((e) => e.postedDate).find((d) => d) ?? null,
      observedAt: entries.map((e) => e.observedAt).find(Boolean) || "",
      postingHash: entries.map((e) => e.postingHash).find(Boolean) || "",
      status: entries.some((e) => e.status === "open")
        ? "open"
        : (entries.some((e) => e.status === "closed") ? "closed" : "unknown"),
      source: base.source,
      angles,
      agreementCount,
      scores,
      consensusScore,
      rationale: entries.map((e) => ({ angle: e.angle, text: e.rationale })),
      matchedClaims: uniq(entries.flatMap((e) => e.matchedClaims || [])),
      matchedPreferences: uniq(entries.flatMap((e) => e.matchedPreferences || [])),
      concerns: uniq(entries.flatMap((e) => e.concerns || [])),
      concernsByAngle: entries.flatMap((e) =>
        (e.concerns || []).map((text) => ({ angle: e.angle, text }))
      ),
      // Card fields come from whichever angle produced them; fit supplies the
      // evidence and gaps, market and growth mostly supply apply notes.
      fitEvidence: entries.flatMap((e) => e.fitEvidence || []),
      gaps: entries.flatMap((e) => e.gaps || []),
      applyNotes: uniq(entries.flatMap((e) => e.applyNotes || [])),
      recommendation: recommendationFor(agreementCount, consensusScore, minAgreement),
      promoteToApplication: false,
    };

    // Every job that does not reach consensus still carries the scouts'
    // reasoning. The reasoning is the product: "this is a security-title role
    // and your evidence is product engineering" tells the operator what to do,
    // and "below_fit_floor (38/60)" tells them nothing.
    const assess = (reason, disposition, blocker = "") => ({
      jobId,
      title: merged.title,
      company: merged.company,
      reason,
      disposition,
      blocker,
      url: merged.url,
      location: merged.location,
      remote: merged.remote,
      compensation: merged.compensation,
      scores: merged.scores,
      rationale: merged.rationale,
      matchedClaims: merged.matchedClaims,
      concerns: merged.concerns,
      concernsByAngle: merged.concernsByAngle,
      fitEvidence: merged.fitEvidence,
      gaps: merged.gaps,
      applyNotes: merged.applyNotes,
    });

    if (isAvoided(merged, avoid)) {
      excluded.push(assess("avoid_list", "no_fit"));
      continue;
    }
    if (merged.status === "closed") {
      excluded.push(assess("posting_closed", "no_fit"));
      continue;
    }
    if (scores.fit === null) {
      excluded.push(assess("missing_fit_score", "no_fit"));
      continue;
    }
    if (scores.fit < fitFloor) {
      // A company the operator explicitly wants is not rejected by one bad req.
      // "Wrong posting" and "wrong company" are different findings with
      // different actions: one is a standing watch, the other is a dead end.
      const wanted = isTargetCompany(merged.company, targetCompanies);
      excluded.push(
        assess(
          `below_fit_floor (${scores.fit}/${fitFloor})`,
          wanted ? "watch" : "no_fit",
          wanted ? "this req, not this company" : "",
        ),
      );
      continue;
    }
    if (agreementCount < minAgreement) {
      excluded.push(
        assess(
          `insufficient_agreement (${agreementCount}/${minAgreement})`,
          "blocked",
          `only ${agreementCount} of ${minAgreement} angles scored it`,
        ),
      );
      continue;
    }
    if (consensusScore < threshold) {
      // Fit already cleared the floor, so the shortfall is never about whether
      // the operator can do the work. Naming the gap in points keeps the
      // decision with the operator instead of burying it in a threshold.
      excluded.push(
        assess(
          `below_threshold (${consensusScore}/${threshold})`,
          "blocked",
          `missed the ${threshold} gate by ${threshold - consensusScore}` +
            `, on ${weakestAngle(scores)} alone`,
        ),
      );
      continue;
    }

    merged.promoteToApplication = true;
    candidates.push(merged);
  }

  candidates.sort((a, b) =>
    b.agreementCount - a.agreementCount ||
    b.consensusScore - a.consensusScore ||
    a.company.localeCompare(b.company)
  );

  return { candidates, excluded };
}

/**
 * Apply a persona's cross-run seen ledger to a freshly reconciled report so an
 * overnight run highlights only genuinely new leads and stops re-surfacing
 * postings already acted on.
 *
 * Pure and deterministic — no I/O. The caller loads/persists the ledger file.
 *
 * Every promoted candidate is annotated with `isNew`, `firstSeenRunDate` and
 * `timesSeen`. Candidates whose ledger `disposition` is `applied` or `ignored`
 * are always moved to `excluded`. When `suppressSeen` is set, any candidate seen
 * in a prior run is also moved to `excluded` with reason `already_seen`. The
 * returned ledger folds in this run's leads.
 *
 * @param {{ report: object, ledger?: object|null, runDate: string, suppressSeen?: boolean }} input
 * @returns {{ report: object, ledger: object }}
 */
export function applySeenLedger({ report, ledger, runDate, suppressSeen = false }) {
  if (!runDate) throw new Error("applySeenLedger requires a runDate.");
  const jobs = { ...(ledger?.jobs || {}) };
  const kept = [];
  const newlyExcluded = [];

  for (const cand of report.candidates) {
    const prior = jobs[cand.jobId];
    const isNew = !prior;
    const firstSeenRunDate = prior?.firstSeenRunDate || runDate;
    const timesSeen = (prior?.timesSeen || 0) + 1;
    const disposition = prior?.disposition || "open";

    jobs[cand.jobId] = {
      title: cand.title,
      company: cand.company,
      url: cand.url || "",
      firstSeenRunDate,
      lastSeenRunDate: runDate,
      timesSeen,
      disposition,
    };

    if (disposition !== "open") {
      newlyExcluded.push({
        jobId: cand.jobId,
        title: cand.title,
        company: cand.company,
        reason: `disposition_${disposition}`,
      });
      continue;
    }
    if (suppressSeen && !isNew) {
      newlyExcluded.push({
        jobId: cand.jobId,
        title: cand.title,
        company: cand.company,
        reason: "already_seen",
      });
      continue;
    }
    kept.push({ ...cand, isNew, firstSeenRunDate, timesSeen });
  }

  const nextReport = {
    ...report,
    candidates: kept,
    excluded: [...(report.excluded || []), ...newlyExcluded],
    newLeadCount: kept.filter((c) => c.isNew).length,
  };
  const nextLedger = {
    schemaVersion: "1.0",
    persona: report.persona,
    updatedAt: new Date().toISOString(),
    jobs,
  };
  return { report: nextReport, ledger: nextLedger };
}

function formatCompensation(compensation) {
  if (!compensation || (compensation.min == null && compensation.max == null)) return "—";
  const currency = compensation.currency || "USD";
  const amount = (value) =>
    value >= 1000 ? `${Math.round(value / 1000)}K` : String(value);
  const band =
    compensation.min != null && compensation.max != null
      ? `${amount(compensation.min)}–${amount(compensation.max)}`
      : amount(compensation.min ?? compensation.max);
  // The band a posting quotes is often for a different city than the one it is
  // listed under, and reading it as local pay is a real mistake to make.
  const where = compensation.locationQualifier
    ? ` (${compensation.locationQualifier})`
    : "";
  return `${currency} ${band}${where}`;
}

function seenLabel(candidate) {
  return candidate.isNew ? "🆕 new" : `seen ×${candidate.timesSeen}`;
}

/** Grouped one-line prompts for the operator, keyed by why a company came back empty. */
const ZERO_CAUSE_ADVICE = {
  title_mismatch: {
    finding: "post this work under titles your queries never asked for",
    offer: "re-run these on unprefixed titles",
  },
  location: {
    finding: "are hiring, but not where you can work",
    offer: "widen `locations` or `remotePreference`",
  },
  level: {
    finding: "only had bands above or below yours open — timing, not fit",
    offer: "re-check these next run",
  },
  none_open: { finding: "had nothing open in scope", offer: "re-check these next run" },
  blocked: {
    finding: "could not be read, so coverage here is unknown rather than empty",
    offer: "retry these with a logged-in session",
  },
  other: { finding: "came back empty for reasons that need a look", offer: "review these by hand" },
};

const CARD_LIMIT = 10;

function dispositionGroup(report, disposition) {
  return (report.excluded || []).filter((e) => e.disposition === disposition);
}

/**
 * Every posting the run scored, best evidence first.
 *
 * Ranking deliberately ignores disposition: the gate decides what is ready to
 * act on, not what the operator is allowed to consider. A strong role held up
 * by one unpublished salary outranks a weak one that happened to pass.
 */
function rankedPostings(report, { includeNoFit = false } = {}) {
  const all = [
    ...report.candidates.map((c) => ({ ...c, disposition: "act" })),
    ...(report.excluded || []).filter(
      (e) => includeNoFit || e.disposition !== "no_fit"
    ),
  ];
  return all.sort((a, b) =>
    (b.scores?.fit ?? 0) - (a.scores?.fit ?? 0) ||
    (b.matchedClaims?.length ?? 0) - (a.matchedClaims?.length ?? 0) ||
    String(a.company).localeCompare(String(b.company))
  );
}

function strengthBar(fit) {
  if (fit == null) return "";
  const filled = Math.round(fit / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

const DISPOSITION_NOTE = {
  act: "",
  watch: "a company you named — this particular req is the mismatch",
  blocked: "",
};

/**
 * Which gate a posting failed, shown on the card itself.
 *
 * The operator asked which roles are the best fit, and a role that missed the
 * threshold by one point is a materially different proposition from one that
 * missed by twenty. `act` cards cleared every gate and carry no reason field,
 * so this is additive and never fires for them.
 */
const GATE_LABEL = {
  watch: "watching this company, not this req",
  blocked: "one gate short",
  no_fit: "not this run",
};

function renderCard(lines, entry, rank, deduped) {
  const facts = [
    entry.location || "",
    entry.remote && entry.remote !== "any" ? entry.remote : "",
    formatCompensation(entry.compensation) === "—" ? "comp not published" : formatCompensation(entry.compensation),
    // Recency marks a card; it does not rank it. A strong resurfaced role still
    // outranks a weak new one.
    deduped ? (entry.isNew ? "🆕 new" : `seen ×${entry.timesSeen} since ${entry.firstSeenRunDate || "?"}`) : "",
  ].filter(Boolean);

  lines.push(`### ${rank}. ${entry.company} — ${entry.title}`);
  lines.push("");
  const fit = entry.scores?.fit;
  if (fit != null) lines.push(`\`${strengthBar(fit)}\` **${fit}** evidence coverage`);
  if (facts.length) lines.push(`${facts.join(" · ")}`);
  if (entry.url) lines.push(`${entry.url}`);
  if (DISPOSITION_NOTE[entry.disposition]) lines.push(`_${DISPOSITION_NOTE[entry.disposition]}_`);
  if (entry.disposition !== "act" && entry.reason) {
    lines.push(`**Gate — ${GATE_LABEL[entry.disposition] || entry.disposition}:** ${entry.reason}`);
  }
  lines.push("");

  lines.push("**Why you fit**");
  if (entry.fitEvidence?.length) {
    for (const e of entry.fitEvidence) {
      lines.push(`- ${e.point} — \`${e.claims.join("`, `")}\``);
    }
  } else {
    // Runs recorded before structured evidence existed still have to render.
    const fitText = (entry.rationale || []).find((r) => r.angle === "fit");
    if (fitText) lines.push(`- ${fitText.text}`);
    if (entry.matchedClaims?.length) {
      lines.push(`- Backed by ${entry.matchedClaims.length} verified claims: \`${entry.matchedClaims.join("`, `")}\``);
    }
  }
  lines.push("");

  const byAngle = (angle) =>
    (entry.concernsByAngle || []).filter((c) => c.angle === angle).map((c) => c.text);
  const legacyGaps = (entry.concernsByAngle || []).length
    ? byAngle("fit")
    : (entry.concerns || []);
  const gaps = entry.gaps?.length
    ? entry.gaps
    : legacyGaps.map((c) => ({ requirement: c, askOperator: "", blocking: false }));
  if (gaps.length) {
    lines.push("**What they ask that your evidence does not cover**");
    for (const g of gaps) {
      lines.push(`- ${g.requirement}${g.blocking ? " **(blocking)**" : ""}`);
      // An unanswered question is a missing claim, not a disqualification.
      if (g.askOperator) lines.push(`  - ❓ ${g.askOperator}`);
    }
    lines.push("");
  }

  // Comp, location and trajectory are things to weigh before applying, not
  // holes in the operator's evidence.
  const notes = entry.applyNotes?.length
    ? [...entry.applyNotes]
    : uniq([...byAngle("market"), ...byAngle("growth")]);
  // A watch card already says the req is the mismatch; repeating it as a
  // blocker reads as two separate problems.
  if (entry.blocker && entry.disposition !== "watch") {
    notes.unshift(`One thing stands in the way: ${entry.blocker}.`);
  }
  if (notes.length) {
    lines.push("**If you apply**");
    for (const n of notes) lines.push(`- ${n}`);
    lines.push("");
  }
}

/**
 * Render a human-readable report.md from a reconciled job-search report.
 *
 * Pure and deterministic — no I/O. The report leads with where to apply: every
 * scored posting is ranked by evidence coverage and the strongest render as
 * self-contained cards (fit, then gaps, then what to do), so the operator never
 * has to assemble a decision from a rejection list. Coverage and no-fit
 * postings are recorded, but they are the appendix, not the report.
 *
 * When the report carries cross-run dedup data (`newLeadCount` is set), leads
 * are marked with how many runs they have appeared in.
 *
 * @param {object} report - a ZJobSearchReport-shaped object
 * @param {object} [options]
 * @param {number} [options.cardLimit] - how many postings render as full cards.
 * @param {boolean} [options.includeNoFit] - rank no-fit postings too, for a
 *   company-scoped sub-report where the operator wants every req accounted for.
 * @param {string} [options.title] - override the H1.
 * @param {string} [options.intro] - extra paragraph under the H1.
 * @returns {string} markdown
 */
export function renderJobSearchReport(report, options = {}) {
  const {
    cardLimit = CARD_LIMIT,
    includeNoFit = false,
    title = null,
    intro = null,
  } = options;
  const deduped = report.newLeadCount != null;
  const ranked = rankedPostings(report, { includeNoFit });
  const cards = ranked.slice(0, cardLimit);
  const overflow = ranked.slice(cardLimit);
  // A no-fit posting promoted into the ranking is already accounted for on a
  // card, so listing it again in the appendix would double-report it.
  const noFit = includeNoFit ? [] : dispositionGroup(report, "no_fit");
  const coverage = report.coverage || [];
  const adjacent = report.adjacent || [];
  const actionable = report.candidates.length;

  const lines = [];
  lines.push(title || `# Job exploration — ${report.persona} (${report.runDate})`);
  lines.push("");
  if (intro) {
    lines.push(intro);
    lines.push("");
  }

  // Distinct companies: the top cards are frequently several reqs at the same
  // employer, and "Vercel and Vercel rank highest" reads like a bug because it
  // is one.
  const lead = [...new Set(cards.map((c) => c.company))].slice(0, 2);
  const leadVerb = lead.length === 1 ? "ranks" : "rank";
  lines.push(
    `**${cards.length} role${cards.length === 1 ? "" : "s"} worth your time.**` +
    (lead.length ? ` ${lead.join(" and ")} ${leadVerb} highest — your evidence covers most of what they ask for.` : "")
  );
  const scoredCount = report.candidates.length + (report.excluded || []).length;
  const emptyCount = coverage.filter((c) => c.found === 0).length;
  if (coverage.length) {
    lines.push(
      `${scoredCount} posting${scoredCount === 1 ? "" : "s"} scored across ${coverage.length} ` +
      `${coverage.length === 1 ? "company" : "companies"} searched` +
      (emptyCount
        ? ` · ${emptyCount} ${emptyCount === 1 ? "company needs" : "companies need"} a wider query (see below)`
        : "")
    );
  }
  lines.push("");
  lines.push(
    `Scouts: ${report.scouts.map((s) => `${s.angle} (${s.candidateCount})`).join(", ")}. ` +
    `${actionable} cleared the consensus gate (≥${report.minAgreement} angles, fit ≥${report.fitFloor ?? 60}, ` +
    `score ≥${report.consensusThreshold}). Sources: ${report.sources.join(", ") || "—"}.`
  );
  lines.push("");

  lines.push(`## Your top matches — ranked by evidence`);
  lines.push("");
  if (cards.length === 0) {
    lines.push(
      "No posting in this run scored against your evidence. That is a result " +
      "about this search, not about you — read the widening section below."
    );
    lines.push("");
  } else {
    lines.push(
      "`evidence coverage` is how much of what the posting asks for your verified " +
      "claims can back. It is not a hiring probability — that depends on the other " +
      "applicants, which no run can see."
    );
    lines.push("");
  }
  cards.forEach((entry, i) => renderCard(lines, entry, i + 1, deduped));

  if (overflow.length) {
    lines.push(`## Also scored — ${overflow.length}`);
    lines.push("");
    for (const e of overflow) {
      const fit = e.scores?.fit == null ? "—" : e.scores.fit;
      lines.push(`- **${e.company}** — ${e.title} · evidence ${fit} · ${e.blocker || e.reason || ""}`);
    }
    lines.push("");
  }

  const byCause = new Map();
  for (const c of coverage) {
    if (c.found !== 0 || !c.zeroCause) continue;
    if (!byCause.has(c.zeroCause)) byCause.set(c.zeroCause, []);
    byCause.get(c.zeroCause).push(c.company);
  }
  if (byCause.size) {
    lines.push("## Want me to widen the net?");
    lines.push("");
    for (const [cause, companies] of byCause) {
      const advice = ZERO_CAUSE_ADVICE[cause] || ZERO_CAUSE_ADVICE.other;
      lines.push(`- **${companies.join(", ")}** ${advice.finding}.`);
      lines.push(`  - → Say the word and I'll ${advice.offer}.`);
    }
    lines.push("");
  }

  if (adjacent.length) {
    lines.push(`## Companies you did not name — ${adjacent.length} verified`);
    lines.push("");
    lines.push("Suggested from your own targets, then searched. Every one has confirmed open roles.");
    lines.push("");
    for (const a of adjacent) {
      const anchor = a.anchorCompany ? ` (like ${a.anchorCompany})` : "";
      lines.push(`### ${a.company}${anchor} — ${a.because}`);
      for (const o of a.openings) {
        lines.push(`- ${o.title}${o.location ? ` · ${o.location}` : ""}${o.url ? ` — ${o.url}` : ""}`);
      }
      if (a.note) lines.push(`_${a.note}_`);
      lines.push("");
    }
  }

  if (coverage.length) {
    const querySets = new Set(coverage.map((c) => c.queries.join(" | ")));
    const sharedQueries = querySets.size === 1 ? coverage[0].queries : null;
    lines.push(`## Appendix — coverage (${coverage.length} companies searched, ${emptyCount} returned nothing)`);
    lines.push("");
    if (sharedQueries) {
      lines.push(`Asked every company for: ${sharedQueries.join(", ") || "—"}.`);
      lines.push("");
    }
    lines.push(
      sharedQueries
        ? "| Company | Found | Read | If empty, why |"
        : "| Company | Asked for | Found | Read | If empty, why |"
    );
    lines.push(sharedQueries ? "|---|---|---|---|" : "|---|---|---|---|---|");
    for (const c of coverage) {
      const cells = [
        c.requested ? `**${c.company}**` : c.company,
        ...(sharedQueries ? [] : [c.queries.join(", ") || "—"]),
        `${c.found}`,
        `${c.read}`,
        c.found === 0 ? c.zeroReason : "—",
      ];
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
    lines.push("Bold = a company you named. A zero is a fact about the query, not a verdict on the company.");
    lines.push("");
  }

  if (noFit.length) {
    lines.push(`## Appendix — not a fit this run (${noFit.length})`);
    lines.push("");
    for (const e of noFit) {
      lines.push(`- ${e.company || "?"} — ${e.title || "?"}: ${e.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

/**
 * Narrow a reconciled report to a single company, preserving every score,
 * rationale, concern, gap and claim citation exactly as the reconciler wrote
 * them.
 *
 * A company-scoped sub-report is a *view*, never a re-scoring: the operator
 * deciding where to apply must see the same numbers the run committed to, so
 * this only filters and never recomputes. Coverage is narrowed to the matching
 * companies so a blocked or zero source stays visible in the sub-report rather
 * than silently disappearing.
 *
 * Pure and deterministic — no I/O.
 *
 * @param {object} report - a ZJobSearchReport-shaped object
 * @param {string} company - company name, matched leniently on punctuation
 * @returns {object} a ZJobSearchReport-shaped object containing only that company
 */
export function filterReportByCompany(report, company) {
  const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const target = norm(company);
  if (!target) throw new Error("filterReportByCompany requires a company name.");
  const hit = (value) => {
    const c = norm(value);
    return c === target || c.startsWith(target);
  };
  const candidates = report.candidates.filter((c) => hit(c.company));
  const excluded = (report.excluded || []).filter((e) => hit(e.company));
  return {
    ...report,
    candidates,
    excluded,
    coverage: (report.coverage || []).filter((c) => hit(c.company)),
    // Adjacency is a whole-run finding about companies the operator did not
    // name; it is not about this company and would be noise here.
    adjacent: [],
    scouts: report.scouts.map((s) => ({
      ...s,
      candidateCount: candidates.length + excluded.length,
    })),
  };
}
