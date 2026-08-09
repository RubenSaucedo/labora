// Recognises posting prose that carries no requirement.
//
// A posting's tail is mostly legal and marketing text: the EEO paragraph, the
// pay range, the benefits list. None of it states something a candidate must
// satisfy, but all of it sits under whatever heading came last -- so a flat
// scraped posting (no markdown headings, which is what real ATS pages produce)
// carries "Requirements" forward to the end of the document and every trailing
// paragraph becomes a requirement.
//
// This matters beyond tidiness. An EEO paragraph reads "...without regard to
// national origin, citizenship status, disability..." and the word
// "citizenship" alone used to be enough to classify it as an `authorization`
// requirement, which carries `hard_eligibility` severity, which no resume can
// ever satisfy, which hard-blocks the release of a legitimate application.
//
// The filter is deliberately timid, because the two directions of error are not
// symmetric. Keeping boilerplate is visible and merely noisy. Withholding a real
// requirement is invisible: it leaves the scoring denominator, so coverage rises
// and `core_requirements_missing` shrinks, and the tool reports a better fit
// than the evidence supports. A false pass is far worse here than a false flag.
//
// Two guards enforce that asymmetry, and neither is a keyword whitelist:
//   1. A line phrased as a demand on the candidate is never boilerplate,
//      however many legal cues it also trips.
//   2. A line carrying a hard-eligibility gate is vetoed by the caller before
//      it ever reaches this module.
// Nothing is dropped silently either: every withheld line is recorded on the
// job spec with its reason, because a filter you cannot audit is where the next
// false signal hides.

// A scraped posting has no reliable line structure: the gate, the pay range and
// the legal footer routinely arrive as one unbroken paragraph. Classifying a
// whole line therefore asks the wrong question, because a single line genuinely
// can contain both a hard gate and the boilerplate that looks like its
// opposite. Every classifier here and in job-requirements.js judges one
// sentence at a time, so "U.S. citizens only. Acme is an equal opportunity
// employer." is read as a gate followed by boilerplate rather than as one
// ambiguous blob.
//
// The split is abbreviation-aware in both directions, because both mistakes
// lose a gate. Splitting inside "Must be a U.S. Permanent Resident." dropped
// the citizenship demand; refusing to split before a lowercase-initial sentence
// let "...communication skills. citizenship status does not affect
// consideration." be read as one citizenship gate. A period preceded by a
// single capital letter or by a known abbreviation is therefore never a
// boundary, and any other terminal punctuation is one regardless of what
// follows.
const ABBREVIATIONS = "Inc|Ltd|Corp|Co|etc|vs|e\\.g|i\\.e|approx|Mr|Ms|Mrs|Dr|Prof|Sr|Jr|St|No|Fig|Dept|Est";
const SENTENCE_BOUNDARY = new RegExp(
  `(?<![A-Z]\\.)(?<!\\b(?:${ABBREVIATIONS})\\.)(?<=[.!?])\\s+(?=\\S)`
);

export function splitSentences(text) {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// Equal-opportunity and non-discrimination text. Every phrase here describes
// what the *employer* does, never what the candidate must be.
//
// Deliberately absent: "reasonable accommodation" and "consideration for
// employment". Both are ordinary vocabulary in HR and People roles ("own the
// reasonable accommodation request workflow" is a real job duty), and a genuine
// EEO footer almost always trips one of the phrases below as well, so dropping
// them costs little detection and removes a large over-match.
const EEO_PATTERNS = [
  /\bequal (?:employment )?opportunity\b/i,
  /\bconsidered? for employment without\b/i,
  /\b(?:does|do) not discriminate\b/i,
  /\bwithout regard to\b/i,
  /\bregardless of (?:race|religion|gender|sex|age|national origin|citizenship)\b/i,
  /\baffirmative action employer\b/i,
  /\bprotected veteran status\b/i,
  /\bpursuant to the (?:san francisco|los angeles|new york)[^.]*ordinance\b/i,
  /\barrest and conviction record/i,
];

// Pay disclosure paragraphs, which many jurisdictions now mandate.
const COMPENSATION_PATTERNS = [
  /\b(?:base )?(?:pay|salary|compensation) range\b/i,
  /\brange for this (?:role|position|job)\b/i,
  /\b(?:base )?(?:pay|salary) for this (?:role|position|job)\b/i,
  /\bon[- ]target earnings\b/i,
  /\bactual (?:compensation|pay|salary)\b/i,
  /\bcompensation (?:will|may) (?:vary|depend)\b/i,
];

// Pay-disclosure sentences name experience and skills as the factors that set
// an offer -- "Actual compensation is based on skills, experience, and
// location." The requirement-shape guard below sees "experience" and "skills"
// and would keep the sentence as a scored `core` requirement that any resume
// mentioning compensation could match.
//
// The override is anchored on compensation being the *subject*. An earlier
// draft matched the factor phrasing anywhere in the sentence and then tried to
// rescue genuine duties with a list of leading verbs. That list is unbounded by
// construction: "Create the pay range for each role based on qualifications and
// location" is a real duty that no allowlist predicted, and withholding it took
// coverage to 100% with nothing missing. Asking who the sentence is *about*
// separates the two without enumerating verbs.
const COMPENSATION_SUBJECT =
  /^(?:the |your |this |our |actual |final |starting |initial |base |total |target )*(?:pay|salary|compensation|earnings|offer|(?:pay|salary|compensation) range)\b[^;\n]{0,60}?\b(?:is|are|will be|may be|will vary|may vary|varies|depends?|depending|is based on|are based on|commensurate with|determined by)\b/i;

// Benefits and perks blurbs.
const BENEFITS_PATTERNS = [
  /\bbenefits (?:include|package)\b/i,
  /\b401\s*\(?k\)?\b/i,
  /\b(?:medical|health)(?:,| and)? (?:dental|vision)\b/i,
  /\bpaid (?:time off|parental leave|holidays)\b/i,
  /\bunlimited pto\b/i,
  /\bequity (?:package|grant)\b/i,
  /\bwellness stipend\b/i,
];

// Phrasing that makes a line a demand on the candidate or a description of the
// work, rather than prose about the employer. This is the real safety valve.
//
// An earlier draft used the canonical skill alias table instead. That table is
// small and technology-focused, so it returned nothing for Excel, SQL, payroll
// or Workday, and on a Total Rewards or People posting the boilerplate patterns
// ate seven of nine genuine requirements -- reporting 100% coverage and zero
// missing core requirements for a resume that matched two. Phrasing generalises
// across domains where a vocabulary list cannot.
const REQUIREMENT_SHAPE = [
  /\b(?:must|should|shall)\b/i,
  /\b(?:is|are)\s+(?:required|preferred)\b/i,
  /\b\d+\+?\s*(?:-|to)?\s*\d*\s*years?\b/i,
  /\bexperience\b/i,
  /\bability to\b/i,
  /\bproficien(?:t|cy)\b/i,
  /\bfamiliarity\b/i,
  /\bdemonstrated\b/i,
  /\btrack record\b/i,
  /\bknowledge of\b/i,
  /\bskills?\b/i,
  /\byou (?:will|have|are|should)\b/i,
  /\b(?:bachelor|master|phd|degree)\b/i,
  // An ownership verb counts only when the applicant is its subject. "We build
  // products people love" and "Our team will ensure every employee is
  // supported" are company prose, not conditions, and letting them qualify kept
  // marketing copy in the scored requirement set.
  /\b(?:own|manage|lead|drive|build|design|develop|maintain|administer|partner|collaborate|deliver|operate|oversee|ensure|advise)\b/i,
];

// Employer-subject constructions, which the ownership verbs above must not
// rescue. Checking only the token immediately before the verb was trivially
// bypassed by an auxiliary ("Our team will ensure...", "We will build...").
//
// The lookbehind matters as much as the pattern: in "Coordinate with our team
// to design integrations", "our team" is the object of a preposition and the
// candidate is still the one being instructed. Reading it as employer prose
// withheld a genuine duty.
const EMPLOYER_SUBJECT =
  /(?<!\b(?:with|alongside|for|to|of|and|within|across|among|between|on|at|in|by|from|supporting|joining)\s)\b(?:we|our team|our company|the company|the team|[A-Z][a-z]+ Inc\.?)\s+(?:\w+ ){0,2}?(?:own|manage|lead|drive|build|design|develop|maintain|administer|partner|collaborate|deliver|operate|oversee|ensure|advise)s?\b/i;

const CATEGORIES = [
  ["eeo", EEO_PATTERNS],
  ["compensation", COMPENSATION_PATTERNS],
  ["benefits", BENEFITS_PATTERNS],
];

// Whether the sentence is *shaped* like a statement about the employer rather
// than an instruction to the candidate.
//
// This is the one boundary that can be drawn without an ever-growing list. A
// duty is imperative -- it opens with a verb and has no subject -- and English
// verbs are unbounded, which is why two successive verb allowlists failed. The
// words that can open a *subject* are a closed class: determiners, pronouns,
// quantifiers, and the handful of nouns a posting uses as a topic. Requiring
// one of those keeps "Manage the benefits package for all employees" and
// "Own the EEO program and ensure Acme is an equal opportunity employer" as
// duties, while "Our benefits package includes..." remains employer prose.
const STATEMENT_SUBJECT =
  /^(?:the|our|we|us|all|any|every|each|this|these|those|their|its|a|an|actual|final|starting|base|total|employees?|benefits|perks|compensation|salary|pay|equal|qualified)\b/i;

// A duty need not be imperative. "The candidate will manage the benefits
// package" is declarative and opens with a determiner, so the subject test
// above claimed it as employer prose and deleted it. When the subject is the
// person being hired, the sentence is about them whatever it goes on to say.
const CANDIDATE_SUBJECT =
  /^(?:the\s+|a\s+|an\s+|our\s+|this\s+)?(?:successful\s+|ideal\s+|right\s+|selected\s+|chosen\s+|prospective\s+)?(?:candidates?|applicants?|new hire|hire|person|you|your\s+(?:role|responsibilities|day|work))\b/i;

// A named company followed by a finite verb is also a subject: "Acme is an
// equal opportunity employer." The finite verb is what distinguishes it from an
// imperative, since both start with a capital letter.
const COMPANY_SUBJECT =
  /^[A-Z][A-Za-z0-9&.'-]*(?:\s+(?:Inc|LLC|Ltd|Corp)\.?)?\s+(?:is|are|was|were|will|does|do|has|have|offers?|provides?|covers?|considers?|believes?|values?|celebrates?|prohibits?)\b/;

function isEmployerProse(text) {
  const trimmed = text.trim();
  if (CANDIDATE_SUBJECT.test(trimmed)) return false;
  return STATEMENT_SUBJECT.test(trimmed) || COMPANY_SUBJECT.test(trimmed);
}

// The employer stating its own practice, as against a sentence that merely
// names the subject. "Own the equal opportunity compliance program and EEO-1
// filings" is a real People-team duty, and withholding it on the strength of
// the phrase alone deleted a requirement from a posting whose whole subject is
// this vocabulary.
const EEO_STATEMENT = [
  /\bequal (?:employment )?opportunity employer\b/i,
  /\b(?:is|are) an equal\b/i,
  /\b(?:does|do) not discriminate\b/i,
  /\bwithout regard to\b/i,
  /\bregardless of (?:race|religion|gender|sex|age|national origin|citizenship)\b/i,
  /\baffirmative action employer\b/i,
  /\bprotected veteran status\b/i,
  /\bpursuant to the (?:san francisco|los angeles|new york)[^.]*ordinance\b/i,
  /\barrest and conviction record/i,
  /\bconsidered? for employment without\b/i,
];

// Whether the sentence is *about* pay -- the disclosure paragraph shape --
// rather than merely mentioning it.
const SALARY_DISCLOSURE = [
  COMPENSATION_SUBJECT,
  /^(?:the |this |our )?(?:base )?(?:pay|salary|compensation) range\b/i,
  /\b(?:pay|salary|compensation) range for this (?:role|position|job)\b/i,
  /\bon[- ]target earnings\b/i,
];

// Benefits prose is an offer the employer makes. "Coordinate benefits
// enrollment" names the same nouns and is a duty.
const BENEFITS_OFFER = [
  /\bbenefits (?:include|package)\b/i,
  /^(?:we|our company|the company|[A-Z][a-z]+)\s+(?:also\s+)?(?:offers?|provides?|covers?)\b/i,
  /^(?:benefits|perks)\b/i,
];

// The raw cue, before any guard. Exported so tests can show that a guard, not
// the absence of a cue, is what keeps a genuine requirement.
export function boilerplateReason(text) {
  for (const [reason, patterns] of CATEGORIES) {
    if (patterns.some((pattern) => pattern.test(text))) return reason;
  }
  return null;
}

export function looksLikeRequirement(text) {
  if (SALARY_DISCLOSURE.some((pattern) => pattern.test(text))) return false;
  if (EMPLOYER_SUBJECT.test(text)) return false;
  return REQUIREMENT_SHAPE.some((pattern) => pattern.test(text));
}

// A cue alone never withholds. Withholding is invisible -- the requirement
// leaves the scoring denominator, so coverage rises and nothing is reported
// missing -- so the sentence must also be *about* the employer's own prose.
//
// Two earlier drafts made the decision the other way round: a cue withheld
// unless a list of verbs rescued the sentence. Both lists were unbounded by
// construction. "Manage the pay range..." forced one round of additions and
// "Create the pay range..." and "Coordinate with our team..." defeated the next,
// each one a silent false pass. Asking who the sentence is about is a boundary
// that does not need extending for every verb English contains.
function sentenceNonRequirementReason(text) {
  const reason = boilerplateReason(text);
  if (!reason) return null;
  // A duty is never withheld, however much employer vocabulary it carries.
  // "Own the EEO program and ensure Acme is an equal opportunity employer"
  // contains a verbatim EEO statement and is still the candidate's job.
  if (!isEmployerProse(text)) return null;
  if (reason === "eeo") return EEO_STATEMENT.some((pattern) => pattern.test(text)) ? "eeo" : null;
  if (reason === "compensation") {
    return SALARY_DISCLOSURE.some((pattern) => pattern.test(text)) ? "compensation" : null;
  }
  if (BENEFITS_OFFER.some((pattern) => pattern.test(text))) return "benefits";
  return EMPLOYER_SUBJECT.test(text) && !looksLikeRequirement(text) ? reason : null;
}

// The reason this line is not a requirement, or null when it is one.
//
// Judged per sentence, and withheld only when *every* sentence is boilerplate.
// A scraped posting has no reliable line structure, so a single line genuinely
// can hold a real requirement and a legal footer at once; withholding on the
// strength of one boilerplate cue deleted the requirement along with it.
export function classifyNonRequirement(text) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return null;
  const reasons = sentences.map(sentenceNonRequirementReason);
  if (reasons.some((reason) => reason === null)) return null;
  return reasons[0];
}

// EEO text must never decide a *citizenship* classification. This is deliberate
// duplication of the filter above rather than a shared call site: the two checks
// defend different failures, so if boilerplate ever slips past extraction it
// still cannot become a hard-eligibility gate on the strength of the word
// "citizenship" appearing in a list of protected characteristics.
export function isEeoBoilerplate(text) {
  return EEO_PATTERNS.some((pattern) => pattern.test(text));
}
