import { diffSegments, segmentResume, significantTokens } from "./resume-segments.js";
import { evaluateSectionMissions } from "./section-missions.js";
import { evaluateMetricContexts } from "./metric-context.js";
import { deterministicReaderRisks } from "./reader-context.js";

/**
 * The whole-document audit.
 *
 * Every other check in this pipeline reads one sentence. That is why a resume
 * can pass all of them and still be worse than the document it replaced: the
 * defects that matter most at this stage are *relationships* between sentences.
 * Four bullets that each earn their place, all opening with "Designed and
 * built". A summary that restates the bullet under it. A compression that kept
 * every fact and dropped the evidence of level.
 *
 * None of this is enforceable, and none of it is tried here. These are
 * advisory findings with a named operation attached, because the one thing
 * worse than a document that repeats itself is a tool that refuses to render a
 * person's own career over a cadence heuristic.
 */

const SENIORITY_MARKERS = Object.freeze({
  architecture: /\b(?:architect(?:ed|ure|ing)?|design(?:ed|ing|s)?|service boundar|abstraction|interface contract|schema|system design|redesign(?:ed)?|decompos)/i,
  lifecycle: /\b(?:end[- ]to[- ]end|from design|through rollout|through production|lifecycle|migrat(?:ed|ion|ing)|cutover|deprecat|handoff|rollout|launch(?:ed)?)/i,
  reliability: /\b(?:reliabilit|fail(?:s|ed|ing|ure|ures|over)?|retry|retries|resilien|degradation|incident|on[- ]call|uptime|recovery|fallback|timeout|idempot|partial[- ]result|usable results)/i,
  evaluation: /\b(?:evaluation|evaluat(?:ed|ing)|benchmark|regression|validation|telemetry|observability|monitoring|measured)/i,
  leverage: /\b(?:mentor(?:ed|ing)?|code review|reviewed|standard|adopted|reusable|enabled|documentation|self[- ]service|across (?:teams|services|products))/i,
  ownership: /\b(?:led|owned|owning|drove|sole owner|responsible for the)/i,
  scope: /\b(?:multi[- ](?:tenant|source|service|region)|cross[- ](?:team|service|layer)|platform|fleet|pipeline)/i,
});

export function seniorityMarkers(text) {
  return Object.entries(SENIORITY_MARKERS)
    .filter(([, pattern]) => pattern.test(String(text || "")))
    .map(([name]) => name);
}

const OPENING_STOPWORDS = new Set(["a", "an", "the"]);

function opening(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !OPENING_STOPWORDS.has(word));
  return words.slice(0, 2).join(" ");
}

/**
 * A coarse syntactic fingerprint.
 *
 * Not a parser, and not trying to be. It captures the three shapes that make a
 * resume read as generated: the same opener class, a trailing participial
 * result clause ("..., reducing X by Y"), and a "by <gerund>" method tail.
 * Three bullets with the same fingerprint sound identical however different
 * their nouns, which is precisely the failure a per-sentence check cannot see.
 */
export function clauseShape(text) {
  const value = String(text || "");
  const first = value.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") || "";
  const openerClass = /(?:ed)$/.test(first) ? "past_verb" : (/(?:ing)$/.test(first) ? "gerund" : "other");
  const trailingParticiple = /,\s+\w+ing\b/.test(value);
  const byGerund = /\bby\s+\w+ing\b/.test(value);
  const metricTail = /\bby\s+\d|\bfrom\s+[\d$]|\bto\s+[\d$]/.test(value);
  return [openerClass, trailingParticiple ? "tp" : "-", byGerund ? "bg" : "-", metricTail ? "mt" : "-"].join("|");
}

const VERBISH = /\b\w{3,}(?:ed|ing)\b/;

export function isNounStack(text) {
  const value = String(text || "");
  const fragments = value.split(/,\s*/).map((fragment) => fragment.trim()).filter(Boolean);
  if (fragments.length < 4) return false;
  const bare = fragments
    .slice(1)
    .filter((fragment) => fragment.split(/\s+/).length <= 5 && !VERBISH.test(fragment));
  return bare.length >= 3;
}

function overlap(a, b) {
  const left = new Set(significantTokens(a));
  const right = new Set(significantTokens(b));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.min(left.size, right.size);
}

function finding(severity, code, location, message, route = "") {
  return { severity, code, location, message, route };
}

export function auditDocument({
  resume,
  baselineView = null,
  editorialPlan = null,
  jobSpec = null,
  claimLedger = null,
  experiencePlan = null,
  metricContexts = [],
  postingText = "",
}) {
  const findings = [];
  const segments = segmentResume(resume);
  const prose = segments.filter((entry) =>
    ["summary", "experience", "projects"].includes(entry.section) && entry.kind !== "project_name"
  );

  /* ---------------------------------------------- repeated openings */
  const byRole = new Map();
  for (const segment of segments.filter((entry) => entry.section === "experience")) {
    const key = segment.experienceId || "";
    if (!byRole.has(key)) byRole.set(key, []);
    byRole.get(key).push(segment);
  }
  for (const [role, bullets] of byRole) {
    const openings = new Map();
    for (const bullet of bullets) {
      const key = opening(bullet.text);
      if (!key) continue;
      if (!openings.has(key)) openings.set(key, []);
      openings.get(key).push(bullet.location);
    }
    for (const [key, locations] of openings) {
      if (locations.length < 2) continue;
      findings.push(finding(
        "warning",
        "whole_document_repetition",
        locations.join(", "),
        `${locations.length} bullets under ${role || "this role"} open with "${key}". Adjacent bullets sharing an ` +
        "opening read as one template filled in repeatedly, whatever they say next.",
        "rewrite",
      ));
    }
  }

  /* ------------------------------------------------- clause cadence */
  const shapes = new Map();
  for (const segment of prose) {
    const shape = clauseShape(segment.text);
    if (!shapes.has(shape)) shapes.set(shape, []);
    shapes.get(shape).push(segment.location);
  }
  for (const [shape, locations] of shapes) {
    if (locations.length < 3) continue;
    if (shape.startsWith("other|-|-|-")) continue;
    findings.push(finding(
      "warning",
      "whole_document_repetition",
      locations.join(", "),
      `${locations.length} spans share one clause shape (${shape}). Uniform rhythm is what makes an accurate ` +
      "document read as assembled rather than written.",
      "rewrite",
    ));
  }

  /* ---------------------------------------------------- noun stacks */
  for (const segment of prose) {
    if (!isNounStack(segment.text)) continue;
    findings.push(finding(
      "warning",
      "whole_document_repetition",
      segment.location,
      `${segment.location} is a list of nouns with no accomplishment holding them together. ` +
      "Technical Skills already provides the retrieval coverage this is reaching for.",
      "move",
    ));
  }

  /* --------------------------------------- duplicate bullet purposes */
  const experienceSpans = segments.filter((entry) => entry.section === "experience");
  for (let i = 0; i < experienceSpans.length; i += 1) {
    for (let j = i + 1; j < experienceSpans.length; j += 1) {
      const score = overlap(experienceSpans[i].text, experienceSpans[j].text);
      if (score < 0.7) continue;
      findings.push(finding(
        "warning",
        "bullet_purpose_duplicate",
        `${experienceSpans[i].location}, ${experienceSpans[j].location}`,
        `These two bullets share ${Math.round(score * 100)}% of their significant vocabulary. Check whether they ` +
        "prove different things or whether one of them should be deleted or combined.",
        "combine",
      ));
    }
  }
  for (const role of experiencePlan?.roles || []) {
    const purposes = new Map();
    for (const arc of role.selected || []) {
      const key = significantTokens(arc.purpose).sort().join(" ");
      if (purposes.has(key)) {
        findings.push(finding(
          "warning",
          "bullet_purpose_duplicate",
          `${purposes.get(key)}, ${arc.location || arc.unitId}`,
          `Both arcs are planned to prove "${arc.purpose}".`,
          "delete",
        ));
      } else {
        purposes.set(key, arc.location || arc.unitId);
      }
    }
  }

  /* ------------------------ repetition across sections, two kinds of */
  // Retrieval repetition is purposeful: a term in Skills and in the bullet that
  // proves it does two different jobs for two different readers. Prose
  // repetition is not: a summary sentence that restates a bullet spends the
  // most-read line in the document saying something the reader is about to read
  // anyway. Only the second is reported.
  const summarySpans = segments.filter((entry) => entry.section === "summary");
  for (const sentence of summarySpans) {
    for (const bullet of experienceSpans) {
      const score = overlap(sentence.text, bullet.text);
      if (score < 0.7) continue;
      findings.push(finding(
        "warning",
        "whole_document_repetition",
        `${sentence.location}, ${bullet.location}`,
        `${sentence.location} restates ${bullet.location}. The Summary should interpret what the bullets prove, ` +
        "not preview one of them.",
        "rewrite",
      ));
    }
  }

  const claimSections = new Map();
  const record = (claimId, section) => {
    if (!claimId) return;
    if (!claimSections.has(claimId)) claimSections.set(claimId, new Set());
    claimSections.get(claimId).add(section);
  };
  for (const entry of resume?.provenance?.summary || []) {
    for (const clause of entry.clauses || []) for (const id of clause.claimIds || []) record(id, "summary");
  }
  for (const entry of resume?.provenance?.bullets || []) for (const id of entry.claimIds || []) record(id, "experience");
  for (const entry of resume?.provenance?.skills || []) for (const id of entry.claimIds || []) record(id, "skills");
  for (const project of resume?.projects || []) for (const id of project.claimIds || []) record(id, "projects");

  for (const [claimId, sections] of claimSections) {
    const prosey = [...sections].filter((section) => section !== "skills");
    if (prosey.length < 3) continue;
    findings.push(finding(
      "info",
      "whole_document_repetition",
      claimId,
      `Claim ${claimId} is rendered in ${prosey.join(", ")}. Repetition is fine when each occurrence does a ` +
      "different job for the reader; check that it does here.",
    ));
  }

  /* ------------------------------ placement, borrowed terms, missions */
  const placement = evaluateSectionMissions({ resume, jobSpec, claimLedger, baselineView });
  for (const entry of [...placement.issues, ...placement.warnings]) {
    findings.push(finding(entry.severity, entry.code, entry.location, entry.message, entry.route || ""));
  }

  /* ----------------------------------------------------- metric context */
  // Run here rather than as a separate stage, because a metric's
  // interpretability is a whole-document property: the reader arrives at the
  // number having read everything above it, and the same figure repeated in
  // Summary and a bullet is exactly the case a per-span check cannot see.
  const metrics = evaluateMetricContexts({
    resume,
    contexts: metricContexts,
    claimLedger,
    baselineView,
    segments,
  });
  for (const entry of [...metrics.issues, ...metrics.warnings]) {
    findings.push(finding(entry.severity, entry.code, entry.location, entry.message, entry.route || ""));
  }

  /* -------------------------------------- deterministic reader risks */
  // The decidable half of the cold-reader gate. Catching a launch label with no
  // audience here keeps it out of the isolated reader's budget and makes it
  // reproducible; what a sentence *appears to mean* still needs the reader.
  for (const risk of deterministicReaderRisks({ resume, postingText })) {
    findings.push(finding(risk.severity, risk.code, risk.location, risk.message, risk.route || ""));
  }

  /* --------------------------------- baseline-relative regressions */
  if (baselineView) {
    const diff = diffSegments(baselineView.segments, segments);

    for (const change of diff.modified) {
      const lost = seniorityMarkers(change.before.text)
        .filter((marker) => !seniorityMarkers(change.after.text).includes(marker));
      if (!lost.length) continue;
      findings.push(finding(
        "warning",
        "seniority_scope_loss",
        change.location,
        `The revision of ${change.location} dropped supported evidence of ${lost.join(", ")}. A shorter sentence ` +
        "is a regression when what it removed was the evidence of level.",
        "keep",
      ));
    }
    for (const removal of diff.removed) {
      const lost = seniorityMarkers(removal.before.text);
      if (!lost.length) continue;
      findings.push(finding(
        "info",
        "seniority_scope_loss",
        removal.location,
        `Removing ${removal.location} removed the document's evidence of ${lost.join(", ")} from that role. ` +
        "Confirm another selected bullet still carries it.",
      ));
    }

    if (editorialPlan) {
      const operations = editorialPlan.operations || [];
      const pureRewrites = operations.filter(
        (operation) => operation.operation === "rewrite" && operation.semanticDelta === "none"
      );
      const approvedSpans = baselineView.segments.length || 1;
      if (pureRewrites.length / approvedSpans > 0.3) {
        findings.push(finding(
          "warning",
          "baseline_voice_drift",
          "operations",
          `${pureRewrites.length} of ${approvedSpans} approved spans were rewritten with no change of meaning. ` +
          "Wording that changes without changing what is said is drift away from the voice the operator approved.",
          "keep",
        ));
      }

      // The architecture miss: a span was polished in place when the placement
      // check says the content does not belong where it is. The polish makes
      // the misplacement harder to see, not easier.
      //
      // Every misplacement at a location is reported, not just one. A summary
      // sentence can simultaneously be a mechanism inventory that should move
      // and carry a keyword that should be dropped, and collapsing those to
      // whichever was found last hides half the repair.
      const misplaced = new Map();
      for (const entry of [...placement.issues, ...placement.warnings]) {
        if (!["move", "delete"].includes(entry.route)) continue;
        if (!misplaced.has(entry.location)) misplaced.set(entry.location, []);
        misplaced.get(entry.location).push(entry);
      }
      for (const operation of operations) {
        if (!["rewrite", "make_specific"].includes(operation.operation)) continue;
        for (const target of misplaced.get(operation.location) || []) {
          findings.push(finding(
            "warning",
            "local_polish_architecture_miss",
            operation.location,
            `${operation.location} was ${operation.operation}d, but the placement check says the right operation is ` +
            `"${target.route}": ${target.message}`,
            target.route,
          ));
        }
      }
    }
  }

  const errors = findings.filter((entry) => entry.severity === "error");
  return {
    schemaVersion: "1.0",
    // Advisory by construction. `valid` reports only the boundary-crossing
    // findings that placement raised as errors; cadence, repetition and drift
    // never appear here.
    valid: errors.length === 0,
    issues: errors,
    warnings: findings.filter((entry) => entry.severity !== "error"),
  };
}
