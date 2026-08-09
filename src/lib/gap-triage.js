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
 * Measures how much each term discriminates between this persona's claims.
 *
 * `STOPWORDS` below removes the words that are uninformative in *every* corpus.
 * It cannot remove the ones that are uninformative in *this* one — a real run
 * against a Vercel posting matched a claim on `sharedTerms: ["including"]`, and
 * `including` was simply not on the list. No hand-written list ever contains
 * the next word; this repo has learned that six times now (#37, #41, the verb
 * allowlist). So informativeness is measured rather than enumerated.
 *
 * A term appearing in most of a persona's claims cannot distinguish between
 * them, whatever the word is. One appearing twice is strong evidence. That is
 * document frequency, and it calibrates itself per persona: for someone whose
 * every claim mentions agents, `agent` correctly stops discriminating, while
 * for someone with two such claims it correctly dominates.
 */
export function termWeights(claims) {
  const total = claims.length;
  const docFrequency = new Map();
  for (const claim of claims) {
    for (const term of new Set(searchTerms(claim.fact))) {
      docFrequency.set(term, (docFrequency.get(term) || 0) + 1);
    }
  }
  return { total, docFrequency };
}

// Above this share of a persona's claims a term is treated as carrying no
// signal at all, rather than a little. A word in a quarter of everything the
// candidate has ever done says something about the candidate, not about which
// claim answers this requirement.
//
// The share is only consulted once a term appears in enough claims for the
// ratio to mean anything. In a corpus of three claims, "appears in all of them"
// is a sample size, not a finding, and discarding the term would leave the
// requirement with nothing to match against -- turning a genuinely adjacent
// claim into a reported gap, which is the outcome this whole module exists to
// prevent.
const UNINFORMATIVE_SHARE = 0.25;
const UNINFORMATIVE_MIN_CLAIMS = 5;

function weightOf(term, { total, docFrequency }) {
  const df = docFrequency.get(term) || 0;
  if (df === 0) return 0;
  if (df >= UNINFORMATIVE_MIN_CLAIMS && df / total > UNINFORMATIVE_SHARE) return 0;
  // Smoothed, so a term present in every claim of a small corpus still ranks
  // above one that is absent. Unsmoothed log(total/df) is exactly zero there,
  // which would silently discard the term for the wrong reason.
  return Math.log((total + 1) / (df + 1)) + 1;
}

// A term is distinctive when it points at particular work rather than at the
// general shape of software jobs. Two ways to qualify, both closed: the skills
// lexicon recognises it, or it is rare enough in this persona's own claims to
// single a few of them out.
//
// The second threshold is much tighter than UNINFORMATIVE_SHARE because it
// answers a different question. That one asks "is this word worthless?"; this
// one asks "is this word strong enough to build a question to a human on?" In
// a 188-claim corpus `including` appears in 8 (4.3%) -- rare enough not to be
// discarded, nowhere near specific enough to justify telling someone their
// payroll work is related to an evals requirement.
const DISTINCTIVE_SHARE = 0.02;

function distinctiveTerms(terms, weights, requirementSkills) {
  // Expressed as an absolute count rather than a ratio so it still means
  // something in a small corpus. At 188 claims this admits terms appearing in
  // at most 3; at 2 claims it admits terms appearing in one, which is the right
  // answer there -- a word in both claims of a two-claim ledger distinguishes
  // nothing, however specific the word is.
  const ceiling = Math.max(1, Math.floor(DISTINCTIVE_SHARE * weights.total));
  return terms.filter(({ term }) =>
    requirementSkills.has(term) ||
    (weights.docFrequency.get(term) || 0) <= ceiling
  );
}

/**
 * Finds verified claims that are related without satisfying the requirement.
 *
 * This is the case the tool used to handle worst. Someone who designed and
 * shipped agent workflows, and reviewed their colleague's evaluation harness in
 * detail, does not "lack evals" -- but they also cannot claim to have built one.
 * Both of those are true at once, and the honest move is a question, never a
 * verdict in either direction.
 *
 * Which makes it load-bearing *why* a claim is listed, not just that it is.
 * A real run against a Vercel posting listed a claim as adjacent on the shared
 * word `including`. Adjacency is what keeps a requirement from being reported
 * as a real gap, so the listing is not simply deleted -- but `basis` records
 * whether the connection is substantive, and only a substantive one is worth
 * putting a question to a human about.
 */
export function findAdjacentClaims(ledger, requirement, { limit = 5 } = {}) {
  const terms = new Set(searchTerms(requirement));
  if (!terms.size) return [];
  const requirementSkills = new Set(primaryTerms(requirement));
  const claims = (ledger?.claims || []).filter((c) => c.status !== "rejected");
  const weights = termWeights(claims);
  const scored = [];
  for (const claim of claims) {
    const claimTerms = new Set(searchTerms(claim.fact));
    const shared = [...terms]
      .filter((t) => claimTerms.has(t))
      .map((term) => ({ term, weight: weightOf(term, weights) }))
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight);
    if (!shared.length) continue;
    const distinctive = distinctiveTerms(shared, weights, requirementSkills);
    const namedSkill = distinctive.some(({ term }) => requirementSkills.has(term));
    scored.push({
      claimId: claim.id,
      fact: claim.fact,
      sharedTerms: shared.map((entry) => entry.term),
      distinctiveTerms: distinctive.map((entry) => entry.term),
      basis: namedSkill ? "named_skill" : distinctive.length ? "distinctive_terms" : "incidental",
      relatedness: Number(shared.reduce((sum, e) => sum + e.weight, 0).toFixed(3)),
    });
  }
  return scored
    .sort((a, b) => b.relatedness - a.relatedness)
    .slice(0, limit);
}

/** Adjacency strong enough to justify interrupting a human with a question. */
export function isSubstantiveAdjacency(claim) {
  return claim.basis === "named_skill" || claim.basis === "distinctive_terms";
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
    const substantive = adjacent.filter(isSubstantiveAdjacency);
    // Incidental adjacency is still adjacency -- it is why this is not reported
    // as a real gap. But it is not grounds to put a question to a human. A
    // question built on a shared word like "including" would name work the
    // candidate never connected to the requirement and invite them to agree
    // that it is connected, which is a leading question built on noise.
    return {
      requirement: requirement?.text || String(requirement),
      status: GAP_STATUS.ADJACENT,
      because: substantive.length
        ? "Verified work is related to this without establishing it. That is a question to ask, not a conclusion to draw in either direction."
        : "Verified work overlaps this only in general terms. Related enough not to call it a gap, not specific enough to build a question on.",
      evidence: [],
      adjacentClaims: adjacent,
      routes: substantive.length
        ? [{
          kind: "ask_scoped_question",
          effort: "minutes",
          horizon: "today",
          // The question names what is already verified, so the candidate is
          // confirming a specific boundary rather than being asked to self-assess.
          action: `Ask what the candidate's actual involvement was, naming the adjacent work: ${substantive.map((a) => a.claimId).join(", ")}. Anything confirmed still needs a durable source before it can be printed.`,
        }]
        : [{
          kind: "mine_corpus",
          effort: "minutes",
          horizon: "today",
          action: "Re-read the corpus for this requirement directly. The overlap found here is general-purpose language, so it neither establishes nor excludes the requirement.",
        }],
      escalateToHuman: substantive.length > 0,
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
