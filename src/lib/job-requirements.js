import { SECTION_DEFS } from "./job-sections.js";
import { classifyNonRequirement, isEeoBoilerplate, splitSentences } from "./job-boilerplate.js";
import {
  SKILL_ALIAS_VERSION,
  canonicalSkillsInText,
} from "./skill-aliases.js";

const REQUIREMENT_STOPWORDS = new Set([
  "about", "ability", "all", "also", "and", "are", "basic", "candidate",
  "communication", "company", "excellent", "experience", "familiarity", "for",
  "from", "have", "ideal", "including", "industry", "job", "knowledge", "minimum",
  "must", "need", "our", "preferred", "qualifications", "required", "requirements",
  "responsibilities", "role", "skills", "strong", "successful", "team", "that",
  "the", "this", "understanding", "with", "work", "working", "years", "you", "your",
]);

function normalizeHeading(line) {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
}

function sectionForHeading(line) {
  const heading = normalizeHeading(line);
  const matches = SECTION_DEFS.flatMap((definition) =>
    definition.cues
      .filter((cue) => heading === cue || heading.includes(cue))
      .map((cue) => ({
        label: definition.label,
        exact: heading === cue,
        cueLength: cue.length,
      }))
  ).sort((a, b) => Number(b.exact) - Number(a.exact) || b.cueLength - a.cueLength);
  return matches[0]?.label;
}

function isHeading(line) {
  const trimmed = line.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  if (/^[A-Z][A-Za-z &/()-]{2,60}:$/.test(trimmed)) return true;
  if (/^[-*•]\s+/.test(trimmed) || !sectionForHeading(trimmed)) return false;

  const heading = normalizeHeading(trimmed);
  const isExactCue = SECTION_DEFS.some((definition) => definition.cues.includes(heading));
  const isConventionalHeading = heading.split(/\s+/).length <= 6 &&
    /\b(?:qualifications|requirements|responsibilities|skills|duties|overview)\b$/.test(heading);
  if (isExactCue || isConventionalHeading) return true;
  return false;
}

function cleanRequirementText(line) {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function requirementPriority(section) {
  if (section === "requirements") return "required";
  if (section === "nice_to_have") return "preferred";
  return "responsibility";
}

// A scraped posting has no reliable line structure: the gate, the pay range and
// the legal footer routinely arrive as one unbroken paragraph, so every
// classifier below judges one sentence at a time. See `splitSentences`.
function anySentence(text, predicate) {
  return splitSentences(text).some(predicate);
}

// "No visa sponsorship is available" contains "sponsorship is available".
// Matching that phrase without checking for negation inverts the meaning of the
// sentence, which downgrades a genuine hard-eligibility gate to a soft signal
// and tells the operator a job is open to them when it is not. That is the same
// failure as the EEO misclassification, pointing the other way.
function sentenceDeniesSponsorship(text) {
  return (
    /\bno\s+(?:visa\s+)?sponsorship\b/i.test(text) ||
    /\bsponsorship\s+(?:is\s+|will\s+)?(?:un(?:available)|not\s+(?:be\s+)?(?:available|provided|offered|possible))\b/i.test(text) ||
    /\b(?:cannot|can\s?not|can't|unable to|not able to|does not|do not|will not|won't)\s+(?:currently\s+)?(?:provide|offer|support)\s+(?:visa\s+|immigration\s+)?sponsorship\b/i.test(text) ||
    /\b(?:cannot|can\s?not|can't|unable to|not able to|does not|do not|will not|won't)\s+sponsor\b/i.test(text) ||
    // The negative outcome must be about eligibility. A bare negation let
    // "Candidates requiring sponsorship will not be discriminated against" --
    // the opposite of a gate -- read as one, now that an explicit denial is
    // checked before the protective patterns.
    /\b(?:requiring|require|who require|needing|in need of)\s+(?:visa\s+|immigration\s+)?sponsorship\b[^;,\n]{0,30}\b(?:will not be considered|cannot be considered|are not (?:eligible|considered)|is not (?:eligible|considered)|not eligible|ineligible)\b/i.test(text)
  );
}

function sentenceOffersSponsorship(text) {
  if (sentenceDeniesSponsorship(text)) return false;
  return (
    /\b(?:visa )?sponsorship (?:is )?(?:available|provided|offered)\b/i.test(text) ||
    /\b(?:we|company|employer) (?:can|will) sponsor\b/i.test(text)
  );
}

function sponsorshipDenied(text) {
  return anySentence(text, sentenceDeniesSponsorship);
}

function sponsorshipAvailable(text) {
  return anySentence(text, sentenceOffersSponsorship);
}

// Phrasing that makes the sentence an obligation on the applicant rather than a
// statement about the employer or its existing staff. Addressing alone is not
// enough: "You have the right to work in an environment free from
// discrimination" is aimed squarely at the reader and demands nothing, so bare
// `you`/`your` produced hard blocks on inclusive policy prose.
const CANDIDATE_DEMAND = /\b(?:must|shall|required|requires|require|need to|needs to)\b/i;

// Phrases that state a condition on the applicant outright. These are checked
// before the EEO short-circuit, because an explicit demand cannot be undone by
// a legal footer sharing its paragraph.
const EXPLICIT_AUTHORIZATION = [
  /\b(?:work|employment) authorization (?:is )?(?:required|a requirement)\b/i,
  /\bwithout (?:the need for )?(?:visa |immigration )?sponsorship\b/i,
  /\b(?:do not|does not|cannot|can\s?not|will not|unable to) (?:currently )?(?:sponsor|offer sponsorship|provide sponsorship)\b/i,
  /\bwork permit (?:is )?required\b/i,
  /\bindefinite leave to remain\b/i,
];

// The same phrases in their bare form, which are only a gate when the sentence
// is actually addressed to the applicant.
const CONDITIONAL_AUTHORIZATION = [
  /\bauthoriz(?:ed|ation) to work\b/i,
  /\bright to work\b/i,
  /\beligible to work\b/i,
  /\beligibility to work\b/i,
  // A gate is a gate outside the United States too. `authorizationJurisdiction`
  // already resolves `eu` and `uk`, but nothing reached it because every
  // pattern was anchored on US vocabulary.
  /\b(?:work|residence|employment) permit\b/i,
  /\bleave to remain\b/i,
  /\b(?:eu|eea|uk|swiss|schengen) (?:work|residence) (?:permit|visa|authorisation|authorization)\b/i,
  /\bsettled status\b/i,
];

// Citizenship demands that no equal-opportunity paragraph can produce. "U.S.
// citizens only" and "must hold US citizenship" state a condition outright, so
// they outrank an EEO cue or a sponsorship offer sharing the same sentence --
// "U.S. citizens only and Acme is an equal opportunity employer." is one
// sentence, and deferring to the footer deleted the gate and released an
// application for a job the candidate is ineligible for.
const UNAMBIGUOUS_CITIZENSHIP = [
  // A parenthetical may sit between the modal and its verb -- "must, without
  // exception, hold U.S. citizenship" -- so a short aside is allowed there.
  /\b(?:must|shall|required to|need(?:s)? to)\s*(?:,[^,;\n]{0,30},)?\s*(?:be|have|hold|possess|maintain|obtain)\b[^;\n]{0,40}\b(?:citizens?|citizenship|permanent residen)/i,
  /\b(?:requires?|restricted to|limited to|open (?:only )?to)\b[^;\n]{0,40}\b(?:citizens?|citizenship)/i,
  /\bcitizenship requirement\b/i,
  /\b(?:u\.?s\.?|united states|american|canadian|australian)?\s*citizens?(?:hip)? only\b/i,
];

// Weaker phrasings that could plausibly appear inside legal prose, so these
// still defer to the EEO short-circuit.
const AMBIGUOUS_CITIZENSHIP = [
  // The singular noun matters: "U.S. citizen required." is as much a gate as
  // "U.S. citizenship required.", and omitting it lost the gate entirely.
  /\b(?:citizens?|citizenship|residency|permanent residency)\s*(?::|\bis\b)?\s*[^;,\n]{0,20}\b(?:required|mandatory|a requirement)\b/i,
  /\b(?:citizens?|citizenship)\b[^;\n]{0,20}\bis (?:a )?(?:hard )?requirement\b/i,
];

// Prose that protects or welcomes candidates rather than excluding them. Read
// as denials, "candidates requiring sponsorship will not be discriminated
// against" and "we welcome applicants with or without the need for visa
// sponsorship" each produced a hard eligibility gate, which blocks the release
// of a perfectly legitimate application.
const PROTECTIVE_SPONSORSHIP = [
  /\bwith or without\s+(?:the\s+need\s+for\s+)?(?:a\s+)?(?:visa\s+|work\s+|employment\s+|immigration\s+)?sponsorship\b/i,
  /\b(?:will not|shall not|does not|do not)\s+be?\s*(?:discriminat|exclud|penaliz|disadvantag)/i,
  // Bound to the *need* for sponsorship, which is the only thing a welcome
  // protects, and the gap may not contain a negator -- "applicants requiring no
  // sponsorship" is the opposite of needing it, and is itself the gate.
  // A bounded wildcard here masked the demand along with the welcome: "We
  // welcome applicants authorized to work without sponsorship" reads as a gate,
  // and swallowing "authorized to work" as protected prose lost it.
  /\b(?:welcome|encourage)\s+(?:\w+\s+){0,3}?(?:requiring|needing|(?:who|that)\s+(?:require|need))\s+(?:(?!\b(?:no|not|zero|without)\b)\w+\s+){0,2}?sponsorship\b/i,
  /\bregardless of\s+(?:your\s+|their\s+|a\s+|an\s+)?(?:sponsorship|immigration|visa|citizenship|work authorization)\b/i,
  // "the right to work in an environment free from discrimination" is a
  // workplace-conditions promise, not a jurisdiction.
  /\bto work (?:in|from) an?\s+(?:environment|workplace|office|atmosphere|culture)\b/i,
  // A negated demand is the opposite of one. "Acme does not limit employment to
  // U.S. citizens only" states the absence of the very gate its wording names,
  // and reading it as a gate hard-blocks a legitimate application. The object
  // must be the credential itself, so "we do not require a degree, but you must
  // be authorized to work in the US" is untouched.
  // The negation must bind to the credential directly. A bounded wildcard let
  // the clause reach across a contrast into an unrelated demand -- "We do not
  // require a degree, but require U.S. citizenship" -- and protect the very
  // gate that followed it.
  /\b(?:does|do|will)\s+not\s+(?:limit|restrict)\s+(?:\w+\s+){0,2}?to\s+(?:u\.?s\.?|united states|american|canadian)?\s*citizens?\b/i,
  /\b(?:does|do|will)\s+not\s+require\s+(?:applicants?|candidates?|employees?|you)?\s*(?:to\s+(?:be|have|hold|possess)\s+)?(?:a\s+|an\s+)?(?:u\.?s\.?|united states|american|canadian)?\s*citizens(?:hip)?\b/i,
];

// One clause at a time, for the same reason classification is done one sentence
// at a time: a clause is the smallest span whose subject and polarity are
// constant. Two earlier drafts tried to model clause scope with bounded
// wildcards and then with positional arithmetic, comparing where a disclaimer
// ended against where a demand began. Both leaked in the dangerous direction --
// "We encourage applicants but no sponsorship is available for this role"
// let the protective clause swallow the denial -- because a wildcard has no way
// to know it has crossed into a new clause. Splitting first makes the boundary
// explicit, and it degrades safely: an over-split fragment is still classified
// on its own, and a fragment that states a gate still produces one.
// Only coordinating contrast markers, which introduce an independent clause.
// Subordinators were a mistake: splitting "Candidates must, while employed,
// remain authorized to work in the United States." at `while` separated the
// modal from its object and lost the gate entirely.
const CLAUSE_BOUNDARY = /(?:;|,)?\s+(?=\b(?:but|however|yet)\b)|;\s+/i;

function splitClauses(sentence) {
  return sentence
    .split(CLAUSE_BOUNDARY)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

// An employer describing its own compliance process is not making a demand of
// the reader. "As required by federal law, Acme verifies that all employees are
// authorized to work in the United States" states what the company does after
// hiring; reading it as a gate hard-blocks a candidate who is fully eligible.
//
// The subject must be the employer, because the verb alone is ambiguous -- a
// candidate can be told to verify something too. The subject openers are a
// closed class, so this cannot drift the way a verb list does.
const EMPLOYER_VERIFICATION = [
  /\b(?:we|our company|the company|the employer|[A-Z][A-Za-z&.'’-]+(?:\s+(?:Inc|LLC|Ltd|Corp|Corporation|Co)\b\.?)?)\s+(?:will\s+|may\s+|must\s+|is\s+required\s+to\s+|are\s+required\s+to\s+)?(?:verif(?:y|ies)|confirms?|validates?|re-?verif(?:y|ies))\s+(?:\w+\s+){0,4}?(?:employment eligibility|work eligibility|(?:employment|work) authoriz\w*|authoriz\w* to work|identity and employment)/,
  /\b(?:participates? in|uses?|is enrolled in|enrolled in)\s+e-?verify\b/i,
];

const PROTECTIVE_GLOBAL = [...PROTECTIVE_SPONSORSHIP, ...EMPLOYER_VERIFICATION].map(
  (pattern) => new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`)
);

// Protective prose is *masked out*, not used to veto the clause containing it.
//
// Vetoing was circular: the patterns that make "We do not require applicants to
// hold U.S. citizenship" harmless are the same shapes that read as demands, so
// checking demands first produced false gates and checking protection first
// deleted real ones -- "We welcome candidates requiring sponsorship for other
// roles, and applicants for this position must be authorized to work in the
// United States." lost its gate that way. Positional comparison did not resolve
// it either, because it has to assume everything after the protected span is
// unprotected. Removing the protected text and reading what is left makes no
// such assumption: the disclaimer cannot be mistaken for a demand because it is
// gone, and a demand anywhere outside it survives regardless of word order.
function withoutProtectiveProse(clause) {
  return PROTECTIVE_GLOBAL.reduce((text, pattern) => text.replace(pattern, " "), clause);
}

function clauseIsAuthorizationRequirement(text) {
  const clause = withoutProtectiveProse(text);
  // A refusal to sponsor is itself a work-authorization gate, however it is
  // phrased ("no sponsorship", "sponsorship is not available", "we cannot
  // provide sponsorship").
  if (sentenceDeniesSponsorship(clause)) return true;
  // An explicit demand on the applicant wins outright, before the sponsorship
  // offer and before the EEO short-circuit, because a clause routinely carries
  // the gate and a cue that looks like its opposite.
  if (EXPLICIT_AUTHORIZATION.some((pattern) => pattern.test(clause))) return true;
  if (CANDIDATE_DEMAND.test(clause) && CONDITIONAL_AUTHORIZATION.some((p) => p.test(clause))) return true;
  if (UNAMBIGUOUS_CITIZENSHIP.some((pattern) => pattern.test(clause))) return true;
  if (sentenceOffersSponsorship(clause)) return false;
  // Only now may EEO context disqualify the clause. Reaching here means nothing
  // in it demanded authorization outright, so the only remaining candidate
  // signal is the citizenship noun -- exactly the token an EEO paragraph uses to
  // mean the opposite.
  if (isEeoBoilerplate(clause)) return false;
  return AMBIGUOUS_CITIZENSHIP.some((pattern) => pattern.test(clause));
}

function sentenceIsAuthorizationRequirement(text) {
  // Splitting is purely additive. Clauses are examined so a protective clause
  // cannot cancel a gate beside it, and the unsplit sentence is examined too so
  // that a split can never separate a demand from its object. A gate found
  // either way is a gate; the split can only ever add one, never remove one.
  const clauses = splitClauses(text);
  if (clauses.some(clauseIsAuthorizationRequirement)) return true;
  return clauses.length > 1 && clauseIsAuthorizationRequirement(text);
}

// The sentences that actually state the gate. Scoring needs these because the
// stored requirement `text` is the whole source line -- deliberately, since the
// exact text and its line number are the provenance contract -- and reading a
// jurisdiction off the whole line picks up whatever country the legal footer
// happens to mention. Selecting sentences that merely *mention* authorization
// is not enough either: "must be authorized to work in Canada. Visa sponsorship
// is available for positions in the United States." mentions both.
export function authorizationSentences(text) {
  return splitSentences(text).filter(sentenceIsAuthorizationRequirement);
}

function isAuthorizationRequirement(text) {
  // A sponsorship offer only cancels the sentence it appears in. Applied to the
  // whole line it let "...must be authorized to work without sponsorship for
  // this role. Visa sponsorship is available for certain other positions."
  // cancel its own gate.
  return anySentence(text, sentenceIsAuthorizationRequirement);
}

function isClearanceRequirement(text) {
  return anySentence(text, (sentence) =>
    /\b(?:security clearance|clearance required|active clearance|secret clearance|top secret|ts[\s/.-]*sci|sci clearance|public trust)\b/i
      .test(sentence)
  );
}

// A licence obligation, judged one sentence at a time. Whole-line judgement got
// this wrong in both directions: a benefits sentence suppressed a genuine gate
// stated earlier on the same line ("Active CPA license required. Benefits
// include reimbursement for professional license renewal fees."), while benefit
// wording outside the exclusion list still produced a hard block ("Benefits
// include company-paid professional license fees").
//
// The discriminator is obligation grammar rather than an ever-growing list of
// benefit words, because the list can only ever chase the phrasings already
// seen. A sentence that names a licence but never demands one is not a gate.
const LICENCE_OBLIGATION = /\b(?:required|require|must|shall|need(?:s)? to|hold|holds|holding|maintain|possess|obtain|active|current|valid|licensed)\b/i;

// A requirements bullet routinely leaves the obligation implicit and states the
// credential alone -- "Professional license", "Active RN licensure". The
// obligation test above sees no verb and lets it through as an ordinary scored
// requirement, which any resume that merely mentions licences then matches: a
// false pass on a gate no resume can actually satisfy. A short fragment naming
// the credential and nothing else is the heading's obligation, restated.
// Restricted to credentials a *person* holds. An earlier draft accepted any
// short phrase ending in the noun, which turned "Music licenses" and "Business
// license" -- ordinary domain requirements -- into gates no resume can satisfy.
const PERSONAL_CREDENTIAL =
  /\b(?:professional|clinical|medical|nursing|teaching|driver'?s?|state|board|practitioner|pharmacy|contractor'?s?|engineering|legal|bar|licensure)\b/i;
// A known credential-acronym set, not any capitalised token. Accepting
// arbitrary acronyms turned "API license", "IP licenses" and "TV license" into
// gates no resume can satisfy.
const CREDENTIAL_ACRONYM =
  /\b(?:RN|LPN|APRN|ARNP|CRNA|NP|PA|MD|DO|DDS|DMD|DVM|OD|OT|PT|RD|RDN|BSN|MSN|EMT|CNA|LCSW|LMFT|LPC|LMSW|CPA|CFA|CFP|PE|PMP|PHR|SPHR|SHRM|CDL|JD|CISSP|CCNA|CCNP|RHIA|RHIT|CPC)\b/;

function isBareCredentialFragment(text) {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);
  if (words.length > 4) return false;
  if (!/^[\w'’ .:-]*\b(?:licen[cs]e|licensure|certification)s?\b[.:]?$/i.test(trimmed)) return false;
  return PERSONAL_CREDENTIAL.test(trimmed) || CREDENTIAL_ACRONYM.test(trimmed);
}

// Administering other people's credentials is a *duty*, not a demand to hold
// one. "Maintain professional license records and renewal dates for all
// clinicians" names a credential and carries obligation grammar, and was read
// as a gate no resume can satisfy -- on precisely the compliance and clinical-
// operations postings whose actual job is managing licensure.
//
// The tell is the object, not the verb. A verb list cannot work here: the same
// verbs ("maintain", "hold", "administer") are at home in both readings, which
// is the mistake this file has already made twice. What differs is what the
// credential noun is attached to -- an administrative artefact, or the reader.
const CREDENTIAL_ADMIN_OBJECT =
  /\b(?:licen[cs]e|licensure|certification|credential)s?\s+(?:records?|renewals?|verifications?|workflows?|databases?|tracking|compliance|programs?|programmes?|audits?|filings?|expirations?|dates?|status(?:es)?|applications?|submissions?|data|management|administration|process(?:es)?|queue|requirements?|reporting|inventory)\b/i;

// A credential held on someone else's behalf is likewise not a gate.
const CREDENTIAL_THIRD_PARTY =
  /\b(?:for|of)\s+(?:all |our |the |each )?(?:\w+\s+){0,2}?(?:clinicians?|staff|employees|providers?|nurses|physicians?|practitioners?|team members|contractors?|therapists?|technicians?|drivers?|consultants?)\b/i;

function sentenceIsProfessionalLicenseRequirement(text) {
  if (CREDENTIAL_ADMIN_OBJECT.test(text) || CREDENTIAL_THIRD_PARTY.test(text)) {
    return false;
  }
  if (
    /\b(?:software|open[- ]source) licenses?\b/i.test(text) ||
    /\b(?:license|licensing) compliance\b/i.test(text) ||
    /\bsoftware asset\b/i.test(text)
  ) {
    return false;
  }
  // A perk that pays for a licence is the opposite of a condition to hold one.
  if (/\b(?:reimburse|reimbursement|renewal fee|stipend|allowance|discount|company[- ]paid|we (?:cover|pay for)|covered by|benefits include)\b/i.test(text)) {
    return false;
  }
  if (!LICENCE_OBLIGATION.test(text)) return isBareCredentialFragment(text);
  const namedCredentialLicense =
    /\b(?:Active|Current|Valid)\s+[A-Z][A-Z0-9./-]{1,15}\s+(?:license|licensure)\b/.test(text) ||
    /\b[A-Z][A-Z0-9./-]{1,15}\s+(?:license|licensure) required\b/.test(text);
  return (
    namedCredentialLicense ||
    /\b(?:medical|professional|clinical|nursing|engineering|teaching|pharmacy|driver'?s?|state-issued) (?:license|licensure)\b/i.test(text) ||
    /\blicensed (?:engineer|physician|doctor|nurse|attorney|lawyer|pharmacist|clinician|teacher)\b/i.test(text) ||
    /\b(?:bar admission|certification required)\b/i.test(text)
  );
}

function isProfessionalLicenseRequirement(text) {
  return anySentence(text, sentenceIsProfessionalLicenseRequirement);
}

function classifyRequirement(text, priority) {
  if (/\b\d+\+?\s*(?:-|to)?\s*\d*\s*years?\b/i.test(text)) return "years";
  if (/\b(?:bachelor|master|phd|degree|b\.?s\.?|m\.?s\.?)\b/i.test(text)) return "degree";
  if (isAuthorizationRequirement(text)) return "authorization";
  if (isClearanceRequirement(text)) return "clearance";
  if (isProfessionalLicenseRequirement(text)) return "license";
  if (canonicalSkillsInText(text).length) return "skill";
  if (priority === "responsibility") return "responsibility";
  return "other";
}

function requirementSeverity(text, priority, kind) {
  // An offer of sponsorship only softens a line that makes no demand of its
  // own. Applied unconditionally it let "...must be authorized to work without
  // sponsorship for this role. Visa sponsorship is available for certain other
  // positions." demote its own gate to a soft signal -- the same
  // offer-cancels-gate failure as in classification, one layer further down.
  if (sponsorshipAvailable(text) && !isAuthorizationRequirement(text)) {
    return "soft_signal";
  }
  if (priority === "preferred") return "preferred";
  if (priority === "responsibility") return "soft_signal";
  if (["authorization", "clearance", "license"].includes(kind)) return "hard_eligibility";
  if (
    /\b(?:communication|communicate|collaboration|collaborate|interpersonal|team player|mentoring)\b/i
      .test(text)
  ) {
    return "soft_signal";
  }
  return "core";
}

function extractMinimumYears(text) {
  const match = text.match(/\b(\d+)\+?\s*(?:-|to)?\s*\d*\s*years?\b/i);
  return match ? Number(match[1]) : null;
}

export function significantRequirementTokens(text) {
  return cleanRequirementText(text)
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((token) =>
      token.length >= 3 &&
      !REQUIREMENT_STOPWORDS.has(token) &&
      !/^\d+$/.test(token)
    );
}

export function extractJobRequirements({ title = "", company = "", description = "", sourcePath = "" }) {
  const requirements = [];
  const nonRequirements = [];
  let section = "about";

  description.split(/\r?\n/).forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    if (isHeading(trimmed)) {
      section = sectionForHeading(trimmed) || section;
      return;
    }

    const text = cleanRequirementText(trimmed);
    const isBullet = /^[-*•]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed);
    if (!isBullet && !["requirements", "nice_to_have", "responsibilities"].includes(section)) {
      return;
    }
    if (text.length < 4) return;

    // Recorded, never silently dropped: the operator can see exactly what was
    // withheld from scoring and why.
    //
    // Boilerplate detection is advisory, never subtractive. The line is reported
    // so a human can see what the tool believes it is, and is still extracted
    // and scored exactly as before.
    //
    // An earlier draft removed these lines from the requirement set. That is the
    // one failure this tool must not have: a withheld line leaves the scoring
    // denominator, so coverage rises and nothing is reported missing, and the
    // tool reports a better fit than the evidence supports -- invisibly.
    // Adversarial review found four separate constructions that were deleted
    // this way ("Create the pay range for each role...", "The candidate will
    // manage the benefits package...") and each fix produced another, because
    // deciding whose sentence it is from prose alone is not reliable. Keeping
    // the line costs a visible, noisy requirement. Removing it costs a silent
    // false pass. Only the classification is kept; the subtraction is not.
    const carriesHardGate = isAuthorizationRequirement(text) ||
      isClearanceRequirement(text) ||
      isProfessionalLicenseRequirement(text);
    const nonRequirementReason = carriesHardGate ? null : classifyNonRequirement(text);
    if (nonRequirementReason) {
      nonRequirements.push({ text, sourceLine: index + 1, reason: nonRequirementReason });
    }

    const priority = requirementPriority(section);
    const canonicalMatches = canonicalSkillsInText(text);
    const canonicalTerms = canonicalMatches.map((match) => match.canonicalId);
    const surfaceForms = canonicalMatches.map((match) => match.matchedSurface);
    const matchMode = canonicalTerms.length > 1
      ? (/\bor\b/i.test(text) ? "any" : "all")
      : "threshold";

    const primaryKind = classifyRequirement(text, priority);
    const kinds = [primaryKind];
    for (const [kind, detected] of [
      ["authorization", isAuthorizationRequirement(text)],
      ["clearance", isClearanceRequirement(text)],
      ["license", isProfessionalLicenseRequirement(text)],
    ]) {
      if (detected && !kinds.includes(kind)) kinds.push(kind);
    }
    for (const kind of kinds) {
      const usesSkills = ["years", "skill", "responsibility", "other"].includes(kind);
      requirements.push({
        id: `req-${String(requirements.length + 1).padStart(3, "0")}`,
        kind,
        priority,
        severity: requirementSeverity(text, priority, kind),
        text,
        sourceLine: index + 1,
        canonicalTerms: usesSkills ? canonicalTerms : [],
        surfaceForms: usesSkills ? surfaceForms : [],
        matchMode: usesSkills ? matchMode : "threshold",
        minimumYears: kind === "years" ? extractMinimumYears(text) : null,
      });
    }
  });

  return {
    schemaVersion: "1.0",
    title,
    company,
    sourcePath,
    aliasVersion: SKILL_ALIAS_VERSION,
    requirements,
    nonRequirements,
  };
}
