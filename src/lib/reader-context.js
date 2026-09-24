import crypto from "node:crypto";
import { ZColdReaderInput, ZColdReaderReport } from "../schemas/reader-review.js";
import { makeFinding } from "./findings.js";
import { segmentResume } from "./resume-segments.js";

/**
 * Preparing the cold reader's world.
 *
 * `prepareColdReaderInput` takes three strings. It has no parameter for a claim
 * ledger, an accomplishment bank, a strategy, a glossary or a prior
 * conversation, so it cannot forward one -- not because a prompt asks it not
 * to, but because there is nowhere to put it. Anything else passed in is
 * dropped on the floor by the schema, and `privateContextLeaks()` exists so a
 * test can assert that on the produced object rather than trusting the code.
 *
 * The temptation this resists is real: giving the reader "just a little"
 * context makes its findings look smarter and destroys the only thing it
 * measures. A reviewer who knows what the author meant will understand a
 * sentence the recruiter will not.
 */

export const COLD_READER_INPUT_KEYS = ["schemaVersion", "audience", "resumeText", "postingText"];

const PRIVATE_CONTEXT_KEYS = [
  "claims", "claimIds", "claim_ids", "claimLedger", "provenance", "accomplishments",
  "units", "unitIds", "bank", "strategy", "applicationStrategy", "evidence", "sources",
  "glossary", "rationale", "notes_for_human", "notesForHuman", "gaps_or_risks",
  "editorialPlan", "baseline", "identity",
];

export function hashColdReaderInput(input) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      audience: input.audience,
      resumeText: input.resumeText,
      postingText: input.postingText,
    }), "utf8")
    .digest("hex");
}

export function prepareColdReaderInput({ resumeText, postingText = "", audience = "recruiter" }) {
  return ZColdReaderInput.parse({
    schemaVersion: "1.0",
    audience,
    resumeText: String(resumeText || ""),
    postingText: String(postingText || ""),
  });
}

/**
 * Every path at which an object carries something the cold reader must not see.
 * An empty array is the guarantee; this is the assertion the isolation test
 * makes against real produced input rather than against the source.
 */
export function privateContextLeaks(value, trail = "input") {
  const leaks = [];
  const walk = (node, at) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${at}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(node)) {
      if (PRIVATE_CONTEXT_KEYS.includes(key)) leaks.push(`${at}.${key}`);
      walk(entry, `${at}.${key}`);
    }
  };
  walk(value, trail);
  return leaks;
}

/**
 * The deterministic half of the gate.
 *
 * Some context dependence is decidable from the text: a launch-stage label with
 * no audience, a scope word with no denominator, an acronym the posting never
 * uses. Catching those here keeps them out of the model's budget and makes them
 * reproducible. The semantic half -- what a sentence *appears* to mean -- is
 * what the isolated reader is for, and no regex substitutes for it.
 */

const ROLLOUT_LABELS = [
  "private preview", "public preview", "limited availability", "general availability",
  "ga", "beta", "alpha", "early access", "dogfood", "internal launch", "soft launch",
];

const INTERNAL_ROLE_LABELS = [
  "ship owner", "dri", "tpm", "ic", "feature owner", "area owner", "pillar lead",
  "workstream lead", "point of contact",
];

/**
 * Scope words that assert a proportion without naming what it is a proportion
 * of. `all` and `every` are deliberately absent: "all six services" and "every
 * deploy" name their population in the next word, and flagging them would make
 * this fire on ordinary well-written bullets until nobody read it.
 *
 * What remains is the set that genuinely leaves the denominator to the reader.
 */
const SCOPE_WORDS = ["full", "complete", "entire", "global", "company-wide", "organization-wide", "organisation-wide", "100%"];

// A population is named when the span goes on to quantify or delimit it.
const DENOMINATOR_HINT = /\b(?:of|across|among|out of|within|in the)\b|\b\d/i;

const KNOWN_ACRONYMS = new Set([
  "API", "APIS", "UI", "UX", "CI", "CD", "SQL", "HTTP", "HTTPS", "REST", "JSON", "CSS", "HTML",
  "SDK", "CLI", "AWS", "GCP", "SLA", "SLO", "TDD", "QA", "SPA", "CRUD", "DNS", "SSH", "TLS",
  "WCAG", "ARIA", "GPU", "CPU", "RAM", "ORM", "JWT", "RPC", "GRPC", "SAAS", "PAAS", "IAAS",
]);

function containsWord(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

export function deterministicReaderRisks({ resume, postingText = "" }) {
  const findings = [];
  const posting = String(postingText || "").toLowerCase();

  for (const segment of segmentResume(resume)) {
    const text = segment.text;
    const lower = text.toLowerCase();

    for (const label of ROLLOUT_LABELS) {
      if (!containsWord(lower, label)) continue;
      const namesAudience = /\b(?:customer|customers|external|internal|tenant|tenants|user|users|team|teams|pilot|trial)\b/i.test(text);
      if (namesAudience) continue;
      findings.push({
        severity: "warning",
        code: "rollout_label_without_scope",
        location: segment.location,
        phrase: label,
        message:
          `${segment.location} uses the launch stage "${label}" without saying who could use it. ` +
          "A reader cannot tell whether that means external customers, an internal test, or configured availability.",
        route: "make_specific",
      });
    }

    for (const label of INTERNAL_ROLE_LABELS) {
      if (!containsWord(lower, label)) continue;
      findings.push({
        severity: "warning",
        code: "internal_role_label",
        location: segment.location,
        phrase: label,
        message:
          `${segment.location} uses the role label "${label}", which names a responsibility only inside the ` +
          "organisation that coined it. Translate it into what was actually owned.",
        route: "rewrite",
      });
    }

    for (const word of SCOPE_WORDS) {
      if (!containsWord(lower, word)) continue;
      const index = lower.indexOf(word.toLowerCase());
      const following = text.slice(index, index + 80);
      if (DENOMINATOR_HINT.test(following.slice(word.length))) continue;
      findings.push({
        severity: "warning",
        code: "unresolved_scale_or_denominator",
        location: segment.location,
        phrase: word,
        message:
          `${segment.location} says "${word}" without naming the population it is ${word} of. ` +
          "Without the denominator the reader supplies their own, which is usually larger or smaller than the truth.",
        route: "make_specific",
      });
    }

    for (const match of text.matchAll(/\b([A-Z]{2,6})\b/g)) {
      const acronym = match[1];
      if (KNOWN_ACRONYMS.has(acronym)) continue;
      if (posting.includes(acronym.toLowerCase())) continue;
      // An acronym expanded in the same span is self-explaining.
      if (new RegExp(`\\(${acronym}\\)`).test(text)) continue;
      findings.push({
        severity: "info",
        code: "context_dependent_term",
        location: segment.location,
        phrase: acronym,
        message:
          `${segment.location} uses "${acronym}", which the posting never uses and the resume never expands. ` +
          "Expand it once, replace it with the capability it stands for, or drop it.",
        route: "make_specific",
      });
    }
  }

  return findings;
}

const NEXT_ACTIONS = [
  "Translate the term into externally understood responsibility or behaviour",
  "Add compact context that makes its scope or consequence clear",
  "Replace it with the engineering decision or outcome it stood in for",
  "Remove the statement",
  "Accept the finding and continue",
];

/**
 * Turn an isolated reader's report into findings the evidence-aware authoring
 * stage can act on.
 *
 * The status is `uncertain`, never `unsupported`. The cold reader by
 * construction cannot know whether something is supported -- it has never seen
 * the evidence -- and letting its output land in the same bucket as a
 * fabrication would make an interpretation problem look like a lie.
 */
export function coldReaderFindings(report) {
  const parsed = ZColdReaderReport.parse(report);
  return parsed.observations
    .filter((observation) => observation.code !== "understood")
    .map((observation) =>
      makeFinding({
        source: "cold_reader",
        code: observation.code,
        status: "uncertain",
        location: observation.phrase,
        finding:
          `A ${parsed.audience.replace(/_/g, " ")} reading only this resume would take "${observation.phrase}" ` +
          `to mean: ${observation.likelyInterpretation}` +
          (observation.competingInterpretation ? ` It could equally mean: ${observation.competingInterpretation}` : "") +
          (observation.readerQuestion ? ` They would have to ask: ${observation.readerQuestion}` : "") +
          (observation.contributesMeaning ? "" : " Removing it would cost the reader nothing."),
        suggestedActions: NEXT_ACTIONS,
      })
    );
}

export function reportMatchesInput(report, input) {
  return report?.inputHash === hashColdReaderInput(input);
}
