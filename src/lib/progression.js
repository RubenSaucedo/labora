import { renderAuthorization } from "./disclosure.js";

const GENERIC_LABELS = new Set([
  "promoted",
  "promotion",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countPhrase(count) {
  return count === 2 ? "twice" : `${count} times`;
}

export function analyzeProgression(progression, role = "") {
  if (!Array.isArray(progression)) return { line: "", findings: [] };

  const findings = [];
  const candidates = [];
  let unresolvedSuppression = false;

  for (const [index, step] of progression.entries()) {
    if (!step) continue;
    const authorization = renderAuthorization(step);
    if (
      authorization === "withheld_confidential" ||
      authorization === "withheld_unclassified"
    ) {
      continue;
    }
    if (
      authorization === "requires_generalization" &&
      !isNonEmptyString(step.externalLabel)
    ) {
      continue;
    }

    const label = (
      isNonEmptyString(step.externalLabel) ? step.externalLabel : step.label || ""
    ).trim();
    if (!label) continue;

    const normalized = normalizeLabel(label);
    const kind = step.externalLabelKind || "auto";
    if (kind === "none" || kind === "generic") continue;

    if (kind !== "scope_change" && GENERIC_LABELS.has(normalized)) {
      unresolvedSuppression = true;
      findings.push({
        code: "progression_generic_placeholder",
        stepIndex: index,
        label,
      });
      continue;
    }

    if (normalized && normalized === normalizeLabel(role)) {
      unresolvedSuppression = true;
      findings.push({
        code: "progression_duplicates_heading",
        stepIndex: index,
        label,
      });
      continue;
    }

    candidates.push({
      index,
      label,
      normalized,
      date: isNonEmptyString(step.date) ? step.date.trim() : "",
      kind,
    });
  }

  const nodes = [];
  const seenTitles = new Set();
  const scopeGroups = new Map();

  for (const candidate of candidates) {
    if (candidate.kind === "scope_change") {
      const group = scopeGroups.get(candidate.normalized) || [];
      group.push(candidate);
      scopeGroups.set(candidate.normalized, group);
      continue;
    }
    if (seenTitles.has(candidate.normalized)) continue;
    seenTitles.add(candidate.normalized);
    nodes.push({
      index: candidate.index,
      eventCount: 1,
      text: candidate.date ? `${candidate.label}, ${candidate.date}` : candidate.label,
    });
  }

  for (const group of scopeGroups.values()) {
    const dates = group.map((step) => step.date).filter(Boolean);
    if (group.length > 1 && dates.length === group.length) {
      nodes.push({
        index: group[0].index,
        eventCount: group.length,
        text: `${group[0].label} ${countPhrase(group.length)} (${dates.join(", ")})`,
      });
      continue;
    }
    for (const step of group) {
      nodes.push({
        index: step.index,
        eventCount: 1,
        text: step.date ? `${step.label}, ${step.date}` : step.label,
      });
    }
  }

  nodes.sort((a, b) => a.index - b.index);
  const representedEvents = nodes.reduce((total, node) => total + node.eventCount, 0);
  if (nodes.length < 2 && representedEvents < 2) {
    if (candidates.length || unresolvedSuppression) {
      findings.push({ code: "progression_low_information" });
    }
    return { line: "", findings };
  }

  return {
    line: nodes.map((node) => node.text).join(" | "),
    findings,
  };
}
