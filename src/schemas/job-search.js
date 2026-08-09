import { z } from "zod";

const REMOTE = z.enum(["remote", "hybrid", "onsite", "any"]);
const ANGLE = z.enum(["fit", "market", "growth"]);

/**
 * What discovery actually looked at for one company, including the case where
 * it found nothing. A zero result is a search outcome to explain, not an
 * absence to omit: it distinguishes "not hiring" from "my query could not see
 * them", which are opposite instructions to the operator.
 */
export const ZCompanyCoverage = z.object({
  company: z.string().min(1),
  queries: z.array(z.string()).default([]),
  found: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  // Required whenever found === 0, enforced below.
  zeroReason: z.string().default(""),
  zeroCause: z
    .enum(["title_mismatch", "location", "level", "none_open", "blocked", "other"])
    .nullable()
    .default(null),
  requested: z.boolean().default(false),
}).strict().refine((c) => c.found > 0 || c.zeroReason.trim().length > 0, {
  message: "a company that returned nothing must record why",
  path: ["zeroReason"],
});

/**
 * Persona search intent. Lives at profile/search-preferences.json and is the
 * only source of location/comp/target constraints. Scouts treat it as trusted
 * user config; job pages they browse remain untrusted data.
 */
export const ZSearchPreferences = z.object({
  schemaVersion: z.literal("1.0"),
  targetTitles: z.array(z.string().min(1)).min(1),
  targetLevels: z.array(z.string().min(1)).default([]),
  locations: z.array(z.string().min(1)).default([]),
  remotePreference: REMOTE.default("any"),
  minCompensation: z.number().nonnegative().nullable().default(null),
  currency: z.string().min(1).default("USD"),
  mustHaves: z.array(z.string()).default([]),
  // Companies the operator wants to explore. First-class rather than prose in
  // `notes`, because coverage is reported per company: a company that returned
  // nothing is a finding, and prose cannot be checked against a run.
  targetCompanies: z.array(z.string().min(1)).default([]),
  avoid: z.array(z.string()).default([]),
  sources: z.array(z.string().min(1)).min(1),
  goals: z.array(z.string()).default([]),
  notes: z.string().default(""),
  timezone: z.string().min(1).default("UTC"),
}).strict();

const ZCompensation = z.object({
  min: z.number().nonnegative().nullable().default(null),
  max: z.number().nonnegative().nullable().default(null),
  currency: z.string().min(1).default("USD"),
  source: z.string().default(""),
  // The same posting often quotes a band for a location other than the one it
  // is listed under, which changes what the number means to the reader.
  locationQualifier: z.string().default(""),
}).strict();

export const ZDiscoveredJob = z.object({
  jobId: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().default(""),
  url: z.string().default(""),
  officialUrl: z.string().default(""),
  remote: REMOTE.default("any"),
  compensation: ZCompensation.nullable().default(null),
  postedDate: z.string().nullable().default(null),
  observedAt: z.string().datetime({ offset: true }),
  postingText: z.string().min(1),
  postingHash: z.string().regex(/^[a-f0-9]{64}$/i),
  status: z.enum(["open", "closed", "unknown"]).default("unknown"),
  source: z.string().min(1),
}).strict();

export const ZDiscoveryReport = z.object({
  schemaVersion: z.literal("1.0"),
  persona: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  sources: z.array(z.string()).default([]),
  coverage: z.array(ZCompanyCoverage).default([]),
  jobs: z.array(ZDiscoveredJob),
  metadata: z.object({
    model: z.string().default(""),
    evaluatedAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

/** One job as observed and scored by a single scout angle. */
export const ZScoutCandidate = z.object({
  jobId: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().default(""),
  url: z.string().default(""),
  officialUrl: z.string().default(""),
  remote: REMOTE.default("any"),
  compensation: ZCompensation.nullable().default(null),
  postedDate: z.string().nullable().default(null),
  observedAt: z.string().datetime({ offset: true }),
  postingHash: z.string().regex(/^[a-f0-9]{64}$/i),
  status: z.enum(["open", "closed", "unknown"]).default("unknown"),
  source: z.string().min(1),
  angle: ANGLE,
  score: z.number().min(0).max(100),
  rationale: z.string().min(1),
  matchedClaims: z.array(z.string()).default([]),
  matchedPreferences: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  // A card has to say which claim backs which point, so a flat matchedClaims
  // list is not enough. Optional: runs recorded before cards existed still parse
  // and degrade to prose rationale.
  fitEvidence: z.array(z.object({
    point: z.string().min(1),
    claims: z.array(z.string()).min(1),
  }).strict()).default([]),
  gaps: z.array(z.object({
    requirement: z.string().min(1),
    // The gap the operator can answer is worth more than the one they cannot:
    // an unanswered question is a missing claim, not a disqualification.
    askOperator: z.string().default(""),
    blocking: z.boolean().default(false),
  }).strict()).default([]),
  applyNotes: z.array(z.string()).default([]),
}).strict();

/** A single scout's full run output. */
export const ZScoutReport = z.object({
  schemaVersion: z.literal("1.0"),
  angle: ANGLE,
  persona: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  sources: z.array(z.string()).default([]),
  candidates: z.array(ZScoutCandidate),
  metadata: z.object({
    model: z.string().default(""),
    evaluatedAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

/** A job after cross-scout reconciliation. */
export const ZConsensusCandidate = z.object({
  jobId: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().default(""),
  url: z.string().default(""),
  officialUrl: z.string().default(""),
  remote: REMOTE.default("any"),
  compensation: ZCompensation.nullable().default(null),
  postedDate: z.string().nullable().default(null),
  observedAt: z.string().default(""),
  postingHash: z.string().default(""),
  status: z.enum(["open", "closed", "unknown"]).default("unknown"),
  source: z.string().min(1),
  angles: z.array(ANGLE).min(1),
  agreementCount: z.number().int().positive(),
  scores: z.object({
    fit: z.number().min(0).max(100).nullable().default(null),
    market: z.number().min(0).max(100).nullable().default(null),
    growth: z.number().min(0).max(100).nullable().default(null),
  }).strict(),
  consensusScore: z.number().min(0).max(100),
  rationale: z.array(z.object({
    angle: ANGLE,
    text: z.string().min(1),
  }).strict()),
  matchedClaims: z.array(z.string()).default([]),
  matchedPreferences: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  concernsByAngle: z.array(z.object({
    angle: ANGLE,
    text: z.string().min(1),
  }).strict()).default([]),
  fitEvidence: z.array(z.object({
    point: z.string().min(1),
    claims: z.array(z.string()).min(1),
  }).strict()).default([]),
  gaps: z.array(z.object({
    requirement: z.string().min(1),
    askOperator: z.string().default(""),
    blocking: z.boolean().default(false),
  }).strict()).default([]),
  applyNotes: z.array(z.string()).default([]),
  recommendation: z.enum(["strong_lead", "lead", "stretch", "watch"]),
  promoteToApplication: z.boolean(),
  isNew: z.boolean().default(true),
  firstSeenRunDate: z.string().nullable().default(null),
  timesSeen: z.number().int().positive().default(1),
}).strict();

/** One persisted job in the cross-run seen ledger. */
export const ZLedgerJob = z.object({
  title: z.string().default(""),
  company: z.string().default(""),
  url: z.string().default(""),
  firstSeenRunDate: z.string().min(1),
  lastSeenRunDate: z.string().min(1),
  timesSeen: z.number().int().positive(),
  disposition: z.enum(["open", "applied", "ignored"]).default("open"),
}).strict();

/**
 * Persona-level memory of every job surfaced by prior runs. Lives at
 * job-search/seen.json (outside dated run dirs) and is gitignored like the rest
 * of persona data. Lets an overnight run highlight only genuinely new leads and
 * stop re-surfacing postings the operator already applied to or ignored.
 */
export const ZSeenLedger = z.object({
  schemaVersion: z.literal("1.0"),
  persona: z.string().min(1),
  updatedAt: z.string().min(1),
  jobs: z.record(z.string(), ZLedgerJob).default({}),
}).strict();

/**
 * Where a job landed once the gates were applied. The gates route rather than
 * silence: a job below the fit floor is still reported, under the heading that
 * says what to do about it. Hiding a posting destroys the reasoning that
 * explains it, and a report of nothing teaches the operator nothing.
 */
export const DISPOSITION = z.enum(["act", "watch", "blocked", "no_fit"]);

/**
 * A job that did not reach consensus. It keeps the scouts' reasoning, because
 * that reasoning is the product: "this is a security-title role and your
 * evidence is product engineering" is actionable, and "below_fit_floor (38/60)"
 * is not.
 */
export const ZExcludedCandidate = z.object({
  jobId: z.string().min(1),
  title: z.string().default(""),
  company: z.string().default(""),
  reason: z.string().min(1),
  disposition: DISPOSITION.default("no_fit"),
  url: z.string().default(""),
  location: z.string().default(""),
  remote: REMOTE.default("any"),
  compensation: ZCompensation.nullable().default(null),
  scores: z.object({
    fit: z.number().min(0).max(100).nullable().default(null),
    market: z.number().min(0).max(100).nullable().default(null),
    growth: z.number().min(0).max(100).nullable().default(null),
  }).strict().default({ fit: null, market: null, growth: null }),
  rationale: z.array(z.object({
    angle: ANGLE,
    text: z.string().min(1),
  }).strict()).default([]),
  matchedClaims: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  concernsByAngle: z.array(z.object({
    angle: ANGLE,
    text: z.string().min(1),
  }).strict()).default([]),
  fitEvidence: z.array(z.object({
    point: z.string().min(1),
    claims: z.array(z.string()).min(1),
  }).strict()).default([]),
  gaps: z.array(z.object({
    requirement: z.string().min(1),
    askOperator: z.string().default(""),
    blocking: z.boolean().default(false),
  }).strict()).default([]),
  applyNotes: z.array(z.string()).default([]),
  // Set when exactly one constraint stands between this job and consideration,
  // so the operator can see the price of a preference rather than its effect.
  blocker: z.string().default(""),
}).strict();

/**
 * A company proposed by the adjacency pass. `openings` is required because an
 * unverified suggestion is the model guessing from memory — the failure this
 * whole pipeline exists to prevent. Propose, then search, then report.
 */
export const ZAdjacentCompany = z.object({
  company: z.string().min(1),
  because: z.string().min(1),
  anchorCompany: z.string().default(""),
  // Not a boolean claim: an adjacency is verified by the postings it can show.
  verified: z.literal(true),
  openings: z.array(z.object({
    title: z.string().min(1),
    location: z.string().default(""),
    url: z.string().url(),
  }).strict()).min(1),
  note: z.string().default(""),
}).strict();

/** Final consensus report written to job-search/<run-date>/candidates.json. */
export const ZJobSearchReport = z.object({
  schemaVersion: z.literal("1.0"),
  persona: z.string().min(1),
  runDate: z.string().min(1),
  preferencesHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sources: z.array(z.string()).default([]),
  scouts: z.array(z.object({
    angle: ANGLE,
    model: z.string().default(""),
    candidateCount: z.number().int().nonnegative(),
  }).strict()),
  minAgreement: z.number().int().positive(),
  consensusThreshold: z.number().min(0).max(100),
  fitFloor: z.number().min(0).max(100).default(60),
  candidates: z.array(ZConsensusCandidate),
  excluded: z.array(ZExcludedCandidate).default([]),
  coverage: z.array(ZCompanyCoverage).default([]),
  adjacent: z.array(ZAdjacentCompany).default([]),
  newLeadCount: z.number().int().nonnegative().nullable().default(null),
}).strict();
