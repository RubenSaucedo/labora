import fs from "node:fs";
import path from "node:path";

import { canonicalSkillsInText } from "./skill-aliases.js";

/**
 * Classifies an unmatched job requirement before anyone calls it a gap.
 *
 * The pipeline used to go straight from "not in the ledger" to "this is a gap",
 * and in practice most declared gaps were not gaps. They were evidence sitting
 * unmined in `evidence/`, or facts obtainable in minutes from something the
 * candidate already owns and can reach.
 *
 * That distinction is the whole point. "Not in the ledger" is a statement about
 * labora's bookkeeping; "the candidate lacks this" is a statement about a
 * person, and the tool is not entitled to the second one from the first. See
 * PHILOSOPHY.md.
 */

export const GAP_STATUS = {
  // The corpus already answers it. A bookkeeping failure, not a candidate one.
  UNMINED: "unmined",
  // Obtainable from something the candidate already owns and can reach.
  COLLECTIBLE: "collectible",
  // Related verified work exists. Worth a question, never an assumption.
  ADJACENT: "adjacent",
  // Nothing in the corpus, nothing reachable, nothing adjacent.
  REAL_GAP: "real_gap",
};

const TEXT_FILE = /\.(?:md|txt|json)$/i;
const SKIP_DIR = /^(?:node_modules|\.git|generated)$/;

function walk(dir, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIR.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, depth + 1));
    else if (TEXT_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

const STOPWORDS = new Set([
  "and", "the", "with", "for", "from", "into", "using", "years", "year",
  "experience", "strong", "proven", "ability", "work", "working", "team",
  "teams", "plus", "must", "have", "has", "our", "you", "your", "their",
  "will", "are", "any", "all", "this", "that", "such", "over",
]);

function searchTerms(requirement) {
  const text = String(requirement?.text || requirement || "");
  // Surface forms, not just the canonical id: a corpus that says "k8s" answers
  // a requirement that says "Kubernetes", and missing that would report a gap
  // over a synonym.
  const canonical = canonicalSkillsInText(text).flatMap((hit) => [
    hit.canonicalId,
    ...(hit.surfaceForms || []),
  ]);
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set([...canonical, ...words].map((t) => String(t).toLowerCase()))];
}

// A skill named in the requirement is worth more than an incidental word. When
// one is present, a corpus hit requires it -- otherwise "Experience with
// Kubernetes in production" matches any file containing "production".
function primaryTerms(requirement) {
  const text = String(requirement?.text || requirement || "");
  return canonicalSkillsInText(text).flatMap((hit) => [
    hit.canonicalId,
    ...(hit.surfaceForms || []),
  ].map((t) => String(t).toLowerCase()));
}

/**
 * Full-text searches the evidence corpus. A hit means the ledger is incomplete,
 * not that the candidate is: `validate-profile` only checks that existing
 * claims are grounded, never that existing evidence has been mined, so the
 * corpus can hold the answer while the ledger reports a gap and nothing notices.
 */
export function searchCorpus(personaRoot, requirement, { minTerms = 2 } = {}) {
  const terms = searchTerms(requirement);
  if (!terms.length) return [];
  const hits = [];
  for (const file of walk(path.join(personaRoot, "evidence"))) {
    let body;
    try {
      body = fs.readFileSync(file, "utf8").toLowerCase();
    } catch {
      continue;
    }
    const matched = terms.filter((term) => body.includes(term));

    // Two rules, because the requirements differ in kind.
    //
    // When the requirement names a specific skill, that skill must appear --
    // matching only the surrounding prose ("production", "experience") is how a
    // real gap gets waved away. But a named skill appearing IS the signal; it
    // does not need corroborating filler words, or a corpus that says
    // "Kubernetes migration" would fail a requirement worded "Kubernetes in
    // production".
    //
    // When the requirement names no skill at all, fall back to requiring
    // several shared words, since any single one would be a coincidence.
    const primary = primaryTerms(requirement);
    const hit = primary.length
      ? primary.some((term) => body.includes(term))
      : matched.length >= Math.min(minTerms, terms.length);
    if (hit) {
      hits.push({
        path: path.relative(personaRoot, file).split(path.sep).join("/"),
        matchedTerms: matched,
      });
    }
  }
  return hits.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length);
}

/**
 * Finds verified claims that are related without satisfying the requirement.
 *
 * This is the case the tool used to handle worst. Someone who designed and
 * shipped agent workflows, and reviewed their colleague's evaluation harness in
 * detail, does not "lack evals" -- but they also cannot claim to have built one.
 * Both of those are true at once, and the honest move is a question, never a
 * verdict in either direction.
 */
export function findAdjacentClaims(ledger, requirement, { limit = 5 } = {}) {
  const terms = new Set(searchTerms(requirement));
  if (!terms.size) return [];
  const scored = [];
  for (const claim of ledger?.claims || []) {
    if (claim.status === "rejected") continue;
    const claimTerms = new Set(searchTerms(claim.fact));
    const shared = [...terms].filter((t) => claimTerms.has(t));
    if (shared.length) {
      scored.push({ claimId: claim.id, fact: claim.fact, sharedTerms: shared });
    }
  }
  return scored
    .sort((a, b) => b.sharedTerms.length - a.sharedTerms.length)
    .slice(0, limit);
}

/**
 * Names an acquisition path the candidate could actually take.
 *
 * Routes carry effort and horizon because a route that ignores the candidate's
 * time is not a route. Asking a human to answer a question is deliberately the
 * LAST option, not the first: it is the slowest path available and it produces
 * self-report rather than evidence.
 */
export function collectionRoutes(identity, requirement) {
  const routes = [];
  const terms = new Set(searchTerms(requirement));

  const relevant = (text) =>
    [...searchTerms(text)].some((term) => terms.has(term));

  for (const project of identity?.projects || []) {
    if (!project.link) continue;
    if (!relevant(`${project.name} ${project.description || ""}`)) continue;
    routes.push({
      kind: "observe_live_product",
      target: project.link,
      effort: "minutes",
      horizon: "today",
      // Roughly eight minutes of scripted observation once produced a
      // verifiable record covering several "missing" requirements -- and caught
      // a verified claim that direct observation contradicted.
      action: `Run an evidence exploration against ${project.link} and record what it does when acted upon. Load \`evidence-exploration\`; the output grounds claims and may also contradict one.`,
    });
  }

  for (const repo of identity?.repositories || []) {
    routes.push({
      kind: "snapshot_repository",
      target: repo.url || repo.name,
      effort: "minutes",
      horizon: "today",
      action: `Run \`labora snapshot-repos\` so this is machine-retrievable rather than described.`,
    });
  }

  return routes;
}

/**
 * The single entry point. Returns a status, the reason for it, and what to do
 * next -- never a verdict on the person.
 */
export function triageRequirement(requirement, { personaRoot, ledger, identity } = {}) {
  const corpusHits = personaRoot ? searchCorpus(personaRoot, requirement) : [];
  if (corpusHits.length) {
    return {
      requirement: requirement?.text || String(requirement),
      status: GAP_STATUS.UNMINED,
      because: "The evidence corpus already contains material on this; it has not been derived into a claim.",
      evidence: corpusHits.slice(0, 5),
      routes: [{
        kind: "rebuild_ledger",
        effort: "minutes",
        horizon: "today",
        action: "Re-run `profile-builder` over the cited files. This is a bookkeeping gap, not a candidate gap.",
      }],
      escalateToHuman: false,
    };
  }

  const routes = collectionRoutes(identity, requirement);
  const adjacent = findAdjacentClaims(ledger, requirement);

  if (routes.length) {
    return {
      requirement: requirement?.text || String(requirement),
      status: GAP_STATUS.COLLECTIBLE,
      because: "Evidence for this is obtainable from something the candidate already owns and can reach.",
      evidence: [],
      adjacentClaims: adjacent,
      routes,
      escalateToHuman: false,
    };
  }

  if (adjacent.length) {
    return {
      requirement: requirement?.text || String(requirement),
      status: GAP_STATUS.ADJACENT,
      because: "Verified work is related to this without establishing it. That is a question to ask, not a conclusion to draw in either direction.",
      evidence: [],
      adjacentClaims: adjacent,
      routes: [{
        kind: "ask_scoped_question",
        effort: "minutes",
        horizon: "today",
        // The question names what is already verified, so the candidate is
        // confirming a specific boundary rather than being asked to self-assess.
        action: `Ask what the candidate's actual involvement was, naming the adjacent work: ${adjacent.map((a) => a.claimId).join(", ")}. Anything confirmed still needs a durable source before it can be printed.`,
      }],
      escalateToHuman: true,
    };
  }

  return {
    requirement: requirement?.text || String(requirement),
    status: GAP_STATUS.REAL_GAP,
    because: "Nothing in the corpus, nothing reachable, and no adjacent verified work.",
    evidence: [],
    adjacentClaims: [],
    routes: [{
      kind: "build_or_learn",
      effort: "weeks",
      horizon: "next_role",
      // A real gap is still not a verdict. It is the one case where the honest
      // answer is that the evidence does not exist yet -- which is a thing a
      // person can go and change.
      action: "A genuine absence in the current corpus, not a disqualification. Apply on the strength of what is verified, and treat this as something to build or learn if it matters for the roles being targeted.",
    }],
    escalateToHuman: true,
  };
}
