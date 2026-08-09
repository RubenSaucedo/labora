import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJobRequirements } from "../src/lib/job-requirements.js";
import { boilerplateReason, classifyNonRequirement, isEeoBoilerplate, looksLikeRequirement, splitSentences } from "../src/lib/job-boilerplate.js";
import { scoreAts } from "../src/lib/score-resume-ats.js";
import { ZJobSpec } from "../src/schemas/job-spec.js";

// A real scraped posting: no markdown headings, so whatever section heading came
// last carries forward to the end of the document and the trailing legal and pay
// paragraphs land inside "Requirements". Clean markdown never reproduced this,
// which is why the defect survived.
const FLAT_POSTING = `# Senior Frontend Engineer

**Company:** Acme

About the role

Build delightful interfaces used by millions of people every day.

Requirements

- 5+ years of frontend experience
- Strong TypeScript and React skills

The base pay range for this role is $180,000 - $240,000 USD, plus equity.

Benefits include medical, dental and vision coverage, 401(k) matching, and paid time off.

Acme is an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, color, religion, sex, sexual orientation, gender identity, national origin, citizenship status, disability, or protected veteran status.`;

function analyze(description) {
  return extractJobRequirements({ title: "T", company: "C", description });
}

function requirement(text) {
  return analyze(`Requirements\n\n- ${text}`).requirements;
}

function isHardEligibility(text) {
  return requirement(text).some((r) => r.severity === "hard_eligibility");
}

function isHardAuthorization(text) {
  return requirement(text).some((r) => r.kind === "authorization" && r.severity === "hard_eligibility");
}

// The headline defect: an EEO paragraph became a hard-eligibility gate that no
// resume can satisfy, which hard-blocks the release of a legitimate application.
test("an EEO paragraph never produces an authorization requirement", () => {
  const spec = analyze(FLAT_POSTING);
  const authorization = spec.requirements.filter((r) => r.kind === "authorization");
  assert.deepEqual(authorization, [], "EEO boilerplate must not be an authorization requirement");
  assert.deepEqual(
    spec.requirements.filter((r) => r.severity === "hard_eligibility"),
    [],
    "a posting with no eligibility gate must produce no hard eligibility requirement"
  );
});

test("the genuine requirements survive the filter", () => {
  const spec = analyze(FLAT_POSTING);
  const texts = spec.requirements.map((r) => r.text);
  assert.ok(texts.some((t) => /5\+ years of frontend experience/.test(t)));
  assert.ok(texts.some((t) => /TypeScript and React/.test(t)));
});

test("compensation, benefits and EEO prose are withheld from scoring", () => {
  const spec = analyze(FLAT_POSTING);
  const reasons = spec.nonRequirements.map((n) => n.reason);
  assert.ok(reasons.includes("eeo"), JSON.stringify(spec.nonRequirements));
  assert.ok(reasons.includes("compensation"));
  assert.ok(reasons.includes("benefits"));
  for (const entry of spec.nonRequirements) {
    assert.ok(entry.text.length > 0);
    assert.ok(entry.sourceLine > 0);
  }
});

// Withheld, never silently dropped. A filter nobody can audit is where the next
// false signal hides.
test("withheld prose is recorded rather than discarded", () => {
  const spec = analyze(FLAT_POSTING);
  assert.ok(spec.nonRequirements.length >= 3);
  const eeo = spec.nonRequirements.find((n) => n.reason === "eeo");
  assert.match(eeo.text, /equal opportunity employer/i);
});

test("a job spec with withheld prose satisfies the schema", () => {
  const parsed = ZJobSpec.parse(analyze(FLAT_POSTING));
  assert.ok(parsed.nonRequirements.length >= 3);
});

// Additive with a default, so a spec written before this field existed parses.
test("a job spec without nonRequirements still parses", () => {
  const spec = analyze(FLAT_POSTING);
  delete spec.nonRequirements;
  assert.deepEqual(ZJobSpec.parse(spec).nonRequirements, []);
});

test("genuine authorization requirements are still detected", () => {
  const genuine = [
    "Must be authorized to work in the United States without sponsorship",
    "Applicants must be a U.S. citizen",
    "US citizenship required due to federal contract requirements",
    "This position requires US citizenship",
    "Must be a citizen or permanent resident",
    "U.S. citizens only",
    "We are unable to sponsor visas for this position",
  ];
  for (const text of genuine) {
    assert.ok(isHardAuthorization(text), `expected a hard eligibility gate for: ${text}`);
  }
});

// The mirror-image defect found while fixing the first: "No visa sponsorship is
// available" contains "sponsorship is available", so the negation-blind guard
// downgraded a real gate to a soft signal and told the operator a job was open
// to them when it was not.
test("a denial of sponsorship is a hard gate, not a soft signal", () => {
  const denials = [
    "No visa sponsorship is available for this role",
    "Visa sponsorship is not available",
    "We cannot provide visa sponsorship",
    "We are not able to offer immigration sponsorship",
    "Sponsorship is unavailable for this position",
    "We do not sponsor work visas",
  ];
  for (const text of denials) {
    assert.ok(isHardAuthorization(text), `expected a hard eligibility gate for: ${text}`);
  }
});

test("an offer of sponsorship is not an eligibility gate", () => {
  for (const text of [
    "Visa sponsorship is available for this role",
    "We will sponsor qualified candidates",
    "Sponsorship is provided for exceptional candidates",
  ]) {
    assert.equal(isHardAuthorization(text), false, text);
  }
});

// The negation guard must key on sponsorship, not on "cannot" alone.
test("unrelated negations are not read as eligibility gates", () => {
  for (const text of [
    "We cannot provide a relocation package",
    "We do not offer remote work for this role",
    "We do not discriminate on the basis of citizenship status.",
  ]) {
    assert.equal(isHardAuthorization(text), false, text);
  }
});

test("a bare mention of citizenship is not a requirement", () => {
  assert.equal(
    isHardAuthorization("Qualified applicants are considered regardless of citizenship."),
    false
  );
  assert.equal(isEeoBoilerplate("without regard to citizenship status"), true);
});

// Keeping a line is the safe direction: a retained non-requirement is visible
// and merely noisy, while a dropped requirement is invisible -- it leaves the
// scoring denominator, so coverage rises and core_requirements_missing shrinks,
// and the tool reports a better fit than the evidence supports.
test("a line phrased as a demand on the candidate is never demoted as boilerplate", () => {
  const text = "Experience integrating 401(k) recordkeeping systems with payroll providers";
  assert.equal(boilerplateReason(text), "benefits", "the raw cue does fire");
  assert.equal(classifyNonRequirement(text), null, "but requirement phrasing overrides it");
  assert.ok(requirement(text).length > 0);
});

// The guard must generalise past the technology vocabulary the alias table
// happens to know. An earlier draft keyed the safety valve on canonical skill
// matches, and because that table is small and frontend-focused it returned
// nothing for Excel, payroll or Workday -- so on this posting seven of nine
// genuine requirements were withheld and the ATS score reported 100% coverage
// with zero missing core requirements. A false pass is worse than the false
// block this change exists to remove.
test("real requirements survive on a posting outside the alias vocabulary", () => {
  const posting = `Requirements

- 7+ years of experience in compensation and benefits
- Experience with payroll and 401(k) plan administration
- Advanced Excel and SQL skills for compensation modeling
- Experience designing compensation range models and pay bands
- Ability to explain medical, dental and vision plan design to employees
- Manage the annual equity grant cycle and refresh process
- Own the reasonable accommodation request workflow
- Knowledge of paid time off accrual regulations across states
- Must pass a criminal history background check

The base pay range for this role is $150,000 - $190,000 USD.
Benefits include medical, dental and vision coverage, 401(k) matching, and paid time off.
Acme is an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, national origin, or citizenship status.`;

  const spec = analyze(posting);
  // All nine genuine requirements are extracted, and the three boilerplate
  // lines are reported without being removed from the scored set: boilerplate
  // detection is advisory, so a misclassification costs visible noise rather
  // than a silently deleted requirement.
  const texts = spec.requirements.map((r) => r.text);
  for (const expected of [
    "7+ years of experience in compensation and benefits",
    "Manage the annual equity grant cycle and refresh process",
    "Own the reasonable accommodation request workflow",
    "Must pass a criminal history background check",
  ]) {
    assert.ok(texts.some((t) => t.includes(expected)), expected);
  }
  assert.equal(spec.requirements.length, 12, JSON.stringify(spec.nonRequirements, null, 2));
  assert.deepEqual(
    spec.nonRequirements.map((n) => n.reason).sort(),
    ["benefits", "compensation", "eeo"]
  );
});

// Boilerplate detection never removes a line from the scored set. This is the
// structural guarantee, not a property of any one pattern: every adversarial
// false pass found in review was a deleted requirement reporting 100% coverage,
// and no pattern can be trusted to decide whose sentence a line is.
test("a line reported as boilerplate is still extracted and scored", () => {
  const spec = analyze(
    "Requirements\n\nAcme is an equal opportunity employer.\nThe salary range for this role is $150,000 - $200,000."
  );
  assert.equal(spec.nonRequirements.length, 2);
  for (const flagged of spec.nonRequirements) {
    assert.ok(
      spec.requirements.some((r) => r.text === flagged.text),
      `${flagged.text} was removed from the requirement set`
    );
  }
  // ...and it still cannot become a hard gate, which is the actual defect.
  assert.equal(spec.requirements.filter((r) => r.severity === "hard_eligibility").length, 0);
});

// "Reasonable accommodation" and "consideration for employment" are ordinary
// vocabulary in People and HR roles, so they cannot be standalone EEO cues.
test("HR-role duties that echo EEO vocabulary are kept", () => {
  for (const text of [
    "Own the reasonable accommodation request workflow",
    "Own the equal opportunity compliance program and EEO-1 filings",
    "Must pass a criminal history background check",
    "Advise leadership on total compensation range strategy",
  ]) {
    assert.equal(classifyNonRequirement(text), null, text);
  }
});

test("boilerplate categories are reported accurately", () => {
  assert.equal(classifyNonRequirement("Acme is an equal opportunity employer."), "eeo");
  assert.equal(classifyNonRequirement("The base pay range for this role is $180,000 - $240,000."), "compensation");
  assert.equal(classifyNonRequirement("Benefits include medical, dental and vision coverage."), "benefits");
  assert.equal(classifyNonRequirement("5+ years of frontend experience"), null);
  assert.equal(classifyNonRequirement("Strong TypeScript and React skills"), null);
});

// The narrowed citizenship patterns of an earlier draft dropped gates the
// unfixed code caught. The EEO short-circuit is the discriminator, so these can
// stay broad without reintroducing the original defect.
test("citizenship gates are detected across common phrasings", () => {
  for (const text of [
    "Must hold US citizenship",
    "Candidates must have US citizenship or permanent residency",
    "Must be a naturalized or native-born US citizen",
    "Citizenship: US required",
    "This role requires US citizenship",
    "Open only to US citizens",
    "Restricted to U.S. citizens due to federal contract requirements",
    "Citizenship requirement: must be a US citizen",
  ]) {
    assert.ok(isHardAuthorization(text), `expected a hard eligibility gate for: ${text}`);
  }
});

// Non-US phrasings the unfixed code also missed.
test("non-US work authorization gates are detected", () => {
  for (const text of [
    "Must have the right to work in the United Kingdom",
    "You must be eligible to work in Canada without sponsorship",
  ]) {
    assert.ok(isHardAuthorization(text), `expected a hard eligibility gate for: ${text}`);
  }
});

// The failure mode that matters most. A scraped posting routinely runs the gate
// and the legal footer together in one unbroken paragraph, so the cue for
// boilerplate and the cue for a hard gate genuinely do co-occur on one line. If
// the footer wins, the gate disappears from `requirements`, nothing hard-blocks,
// and the pipeline releases an application for a job the candidate cannot hold.
test("a hard gate colocated with EEO prose on one line is kept, not withheld", () => {
  const spec = analyze(
    "Requirements\n\nApplicants must be authorized to work in the United States without sponsorship. Acme is an equal opportunity employer and does not discriminate on the basis of citizenship status."
  );
  assert.equal(spec.nonRequirements.length, 0, JSON.stringify(spec.nonRequirements));
  assert.ok(
    spec.requirements.some((r) => r.kind === "authorization" && r.severity === "hard_eligibility"),
    "the authorization gate must survive its own EEO footer"
  );
});

test("a clearance gate colocated with EEO prose on one line is kept", () => {
  const spec = analyze(
    "Requirements\n\nMust possess an active Top Secret/SCI clearance. Acme is an equal opportunity employer."
  );
  assert.ok(
    spec.requirements.some((r) => r.kind === "clearance" && r.severity === "hard_eligibility"),
    "the clearance gate must survive its own EEO footer"
  );
});

test("a sponsorship denial colocated with EEO prose is kept", () => {
  const spec = analyze(
    "Requirements\n\nNo visa sponsorship is available for this role. Acme is an equal opportunity employer and does not discriminate."
  );
  assert.ok(
    spec.requirements.some((r) => r.kind === "authorization" && r.severity === "hard_eligibility")
  );
});

// Classification is per sentence because a scraped posting has no reliable line
// structure. Every case below sat on a single line where a whole-line judgement
// gave the wrong answer.
test("a citizenship gate colocated with EEO prose survives the short-circuit", () => {
  const spec = analyze("Requirements\n\nU.S. citizens only. Acme is an equal opportunity employer.");
  assert.equal(spec.nonRequirements.length, 0, JSON.stringify(spec.nonRequirements));
  assert.ok(
    spec.requirements.some((r) => r.kind === "authorization" && r.severity === "hard_eligibility"),
    "the EEO footer must suppress only its own sentence"
  );
});

// An offer of sponsorship is scoped to the sentence that makes it. Read across
// the whole line it cancelled a gate stated one sentence earlier -- and it did
// so twice, once in classification and again in severity.
test("a sponsorship offer elsewhere in the line does not cancel a stated gate", () => {
  const text = "Applicants must be authorized to work in the United States without sponsorship for this role. Visa sponsorship is available for certain other positions.";
  assert.ok(isHardAuthorization(text), "the gate must survive an unrelated offer");
});

test("an offer of sponsorship alone is still only a soft signal", () => {
  const found = requirement("Visa sponsorship is available for this role");
  assert.ok(found.length > 0, "the line must still be extracted at all");
  assert.ok(found.every((r) => r.severity === "soft_signal"), JSON.stringify(found));
});

test("candidate-focused sponsorship denials are detected", () => {
  for (const text of [
    "Candidates requiring sponsorship will not be considered",
    "Sponsorship will not be available for this position",
  ]) {
    assert.ok(isHardAuthorization(text), text);
  }
});

// "Right to work" and "eligible to work" are ordinary workplace-policy phrases.
// Matched bare they produced hard eligibility gates -- which hard-BLOCK release
// -- on prose that asks nothing of the applicant at all.
test("workplace-policy prose is not a work authorization gate", () => {
  for (const text of [
    "Acme is an equal opportunity employer. All employees have the right to work in an environment free from discrimination.",
    "Employees are eligible to work remotely after 90 days.",
    "We verify that all employees are authorized to work in the United States.",
  ]) {
    assert.equal(isHardAuthorization(text), false, text);
  }
});

// Sentence splitting, not a character class, is what stops a citizenship match
// spanning two unrelated sentences.
test("a citizenship match cannot span two sentences", () => {
  for (const text of [
    "Candidates must have strong communication skills. Citizens Bank experience is preferred.",
    "We value corporate citizenship. Travel is required for this role.",
  ]) {
    assert.equal(isHardAuthorization(text), false, text);
  }
});

// A perk that pays for a licence is the opposite of a condition to hold one,
// and because a hard gate also vetoes withholding, treating it as one both
// scored the benefit and blocked the release.
test("a licence reimbursement benefit is not an eligibility gate", () => {
  const spec = analyze("Requirements\n\nBenefits include reimbursement for professional license renewal fees.");
  assert.equal(
    spec.requirements.filter((r) => r.severity === "hard_eligibility").length,
    0,
    JSON.stringify(spec.requirements)
  );
  assert.equal(spec.nonRequirements[0]?.reason, "benefits");
});

// Pay-disclosure sentences name experience and skills as the factors that set
// an offer, so the requirement-shape guard kept them as scored `core`
// requirements that any resume mentioning compensation could match.
test("pay-disclosure factors are not requirement phrasing", () => {
  for (const text of [
    "Actual compensation is based on skills, experience, and location.",
    "Compensation will vary depending on experience and location.",
  ]) {
    assert.equal(classifyNonRequirement(text), "compensation", text);
  }
  assert.equal(
    classifyNonRequirement("Advise leadership on total compensation range strategy"),
    null,
    "a genuine compensation duty must still be kept"
  );
});

// An ownership verb counts only when the applicant is its subject.
test("company prose is not kept by an employer-subject verb", () => {
  assert.equal(
    looksLikeRequirement("We build products that millions of people love and we ensure every employee is supported."),
    false
  );
  assert.equal(looksLikeRequirement("Own the annual compensation cycle"), true);
});

// Withholding must not silently swallow a genuine gate that happens to sit in
// the same paragraph region as boilerplate.
test("an eligibility gate is still extracted from a posting full of boilerplate", () => {
  const spec = analyze(`${FLAT_POSTING}\n\nMust be authorized to work in the US without sponsorship.`);
  assert.ok(
    spec.requirements.some((r) => r.kind === "authorization" && r.severity === "hard_eligibility"),
    "a real authorization gate must survive the boilerplate filter"
  );
});

// A stated gate outranks a softer cue sharing its sentence. Sentence scope
// alone could not settle these, because the gate and the cue are joined by
// "and"/"but" rather than a full stop -- so precedence, not finer splitting, is
// what decides them.
test("an explicit gate outranks an EEO cue in the same sentence", () => {
  const spec = analyze("Requirements\n\nU.S. citizens only and Acme is an equal opportunity employer.");
  assert.equal(spec.nonRequirements.length, 0, JSON.stringify(spec.nonRequirements));
  assert.ok(spec.requirements.some((r) => r.severity === "hard_eligibility"));
});

test("an explicit gate outranks a sponsorship offer in the same sentence", () => {
  assert.ok(isHardAuthorization(
    "Sponsorship is available for some roles, but candidates for this position must be authorized to work in the United States without sponsorship."
  ));
});

// Both directions of the split lose a gate: breaking inside "U.S." drops the
// citizenship demand, and refusing to break before a lowercase sentence merges
// two unrelated ones into a false gate.
test("sentence splitting is abbreviation-aware in both directions", () => {
  assert.deepEqual(splitSentences("Must be a U.S. Permanent Resident."), ["Must be a U.S. Permanent Resident."]);
  assert.deepEqual(splitSentences("Acme Inc. is an equal opportunity employer. Travel required."), [
    "Acme Inc. is an equal opportunity employer.",
    "Travel required.",
  ]);
  assert.equal(splitSentences("Strong communication skills. citizenship status does not matter.").length, 2);
  assert.ok(isHardAuthorization("Must be a U.S. Permanent Resident."));
  assert.equal(
    isHardAuthorization("Candidates must have strong communication skills. citizenship status does not affect consideration."),
    false
  );
});

// Prose that protects or welcomes candidates is the opposite of a gate, and a
// false gate hard-blocks a legitimate application.
test("inclusive sponsorship prose is not an eligibility gate", () => {
  for (const text of [
    "You have the right to work in an environment free from discrimination and harassment.",
    "Candidates requiring sponsorship will not be discriminated against.",
    "We welcome applicants with or without the need for visa sponsorship.",
  ]) {
    assert.equal(isHardAuthorization(text), false, text);
  }
});

// Licence detection is per sentence and keyed on obligation grammar, so a
// benefit cannot suppress a real gate and benefit wording outside any exclusion
// list cannot create one.
test("a licence gate and a licence benefit on one line are judged separately", () => {
  assert.ok(isHardEligibility("Active CPA license required. Benefits include reimbursement for professional license renewal fees."));
  assert.equal(isHardEligibility("Benefits include company-paid professional license fees and paid time off."), false);
});

// The jurisdiction must come from the sentence stating the gate. Read across
// the whole line, a legal footer naming a different country matched a resume
// authorized somewhere else entirely.
test("work authorization is matched against the jurisdiction the gate names", () => {
  const jobSpec = analyze(
    "Requirements\n\nCandidates must be authorized to work in Canada. Acme is an equal opportunity employer headquartered in the United States."
  );
  const score = (summary) => scoreAts({
    jobSpec,
    resume: { summary, experience: [], skills: [], education: [] },
  }).hard_eligibility_missing;

  assert.equal(score("Authorized to work in Canada").length, 0, "the Canadian gate must accept a Canadian authorization");
  assert.equal(
    score("Authorized to work in the United States").length,
    1,
    "a US authorization must not satisfy a Canadian gate"
  );
});

// A stated duty outranks a pay-disclosure cue naming the same factors.
test("a compensation duty is kept while a pay-disclosure factor is withheld", () => {
  assert.equal(
    classifyNonRequirement("Manage the pay range for each role based on candidate experience and market location."),
    null
  );
  assert.equal(classifyNonRequirement("Actual compensation is based on skills, experience, and location."), "compensation");
});

// An ownership verb only counts when the applicant is its subject, across
// auxiliaries as well as directly.
test("employer-subject prose is not kept by an ownership verb", () => {
  assert.equal(
    classifyNonRequirement("Our team will ensure employees receive medical, dental and vision coverage."),
    "benefits"
  );
  assert.equal(looksLikeRequirement("Own the annual compensation cycle"), true);
});

// A negated demand is the opposite of one. These name the very gate they
// disclaim, so matching the wording without its polarity hard-blocks a
// legitimate application.
test("a disclaimed citizenship requirement is not a gate", () => {
  for (const text of [
    "Acme does not discriminate and does not limit employment to U.S. citizens only.",
    "We do not require applicants to hold U.S. citizenship and do not discriminate based on citizenship status.",
  ]) {
    assert.equal(isHardAuthorization(text), false, text);
  }
  // The negation must bind to the credential, not swallow a gate stated later.
  assert.ok(isHardAuthorization("We do not require a degree, but you must be authorized to work in the US."));
});

// Guarding remote-work phrasing as protective silently deleted a real gate that
// happened to contain it. The obligation test already distinguishes these, so
// the guard was both redundant and harmful.
test("a remote role can still state a work authorization gate", () => {
  assert.ok(isHardAuthorization("Must be eligible to work remotely in Canada without sponsorship."));
  assert.equal(isHardAuthorization("Employees are eligible to work remotely after 90 days."), false);
});

// "Partner with our team to..." instructs the candidate; the team is the object
// of the preposition, not the subject of the verb.
test("a duty naming the employer's team is still the candidate's duty", () => {
  for (const text of [
    "Partner with our team to design integrations for medical, dental and vision plan administration.",
    "Work with our team to build integrations for 401(k) recordkeeping systems.",
  ]) {
    assert.equal(classifyNonRequirement(text), null, text);
    assert.ok(requirement(text).length > 0, text);
  }
});

// Jurisdiction comes from the sentence classified as the gate, not from any
// sentence that merely mentions the subject.
test("an unrelated sponsorship offer does not set the gate's jurisdiction", () => {
  const jobSpec = analyze(
    "Requirements\n\nCandidates must be authorized to work in Canada. Visa sponsorship is available for positions in the United States."
  );
  const score = (summary) => scoreAts({
    jobSpec,
    resume: { summary, experience: [], skills: [], education: [] },
  }).hard_eligibility_missing;

  assert.equal(score("Authorized to work in Canada").length, 0);
  assert.equal(score("Authorized to work in the United States").length, 1);
});

// A disclaimer names the very gate it disclaims, so it must govern only the
// span it covers. Letting it speak for the whole sentence deleted the gate that
// followed -- and a deleted gate is a false pass, not a missing note.
test("a gate stated after a disclaimer survives the disclaimer", () => {
  assert.ok(isHardAuthorization("We do not require U.S. citizenship, but applicants must hold Canadian citizenship."));
  assert.ok(
    isHardAuthorization(
      "We welcome candidates requiring sponsorship for other roles, but this position requires authorization to work without sponsorship."
    )
  );
  // ...and the disclaimer alone still is not a gate.
  assert.equal(isHardAuthorization("We do not require applicants to hold U.S. citizenship."), false);
});

// The boundary between boilerplate and duty is who the sentence is about, not
// which verb it opens with. Two successive allowlists of leading verbs were
// each defeated by the next ordinary English verb.
test("a duty is kept whatever verb it opens with", () => {
  for (const text of [
    "Create the pay range for each role based on qualifications and location.",
    "Coordinate with our team to design integrations for medical, dental and vision plan administration.",
    "Own the equal opportunity compliance program and EEO-1 filings.",
    "Refresh the salary range for each role every quarter.",
  ]) {
    assert.equal(classifyNonRequirement(text), null, text);
    assert.ok(requirement(text).length > 0, text);
  }
});

// ...while the disclosure paragraphs those duties resemble are still withheld.
test("pay and benefits prose about the employer is still withheld", () => {
  for (const text of [
    "The salary range for this role is $150,000 - $200,000 based on location.",
    "Compensation will vary depending on experience and location.",
    "We offer medical, dental and vision coverage plus a 401(k) match.",
    "Acme is an equal opportunity employer and does not discriminate on the basis of citizenship status.",
  ]) {
    assert.ok(classifyNonRequirement(text), text);
  }
});

// A requirements bullet often leaves the obligation implicit and names only the
// credential. Reading it as an ordinary scored requirement let any resume that
// mentions licences match a gate it cannot satisfy.
test("a bare credential bullet is still a license gate", () => {
  assert.ok(isHardEligibility("Professional license"));
  assert.ok(isHardEligibility("Active RN licensure"));
  // A duty that administers licences is not a demand to hold one.
  assert.equal(classifyNonRequirement("Coordinate license renewals for all clinicians."), null);
});

// A bounded wildcard let a disclaimer reach across a contrast and protect the
// demand on the other side of it.
test("a disclaimer does not reach across a contrast into a real demand", () => {
  const jobSpec = analyze("Requirements\n\nWe do not require a degree, but require U.S. citizenship.");
  const missing = scoreAts({
    jobSpec,
    resume: { summary: "Bachelor of Science in Computer Science", experience: [], skills: [], education: [] },
  }).hard_eligibility_missing;
  assert.equal(missing.length, 1);
});

// Employer vocabulary inside a duty does not make the duty employer prose. The
// test is whether the sentence is *shaped* like a statement -- a closed class
// of subject-starters -- not which verb it opens with.
test("a duty carrying employer vocabulary is kept", () => {
  for (const text of [
    "Manage the benefits package for all employees.",
    "Own the EEO program and ensure Acme is an equal opportunity employer.",
    "Administer the 401(k) plan and annual open enrollment.",
  ]) {
    assert.equal(classifyNonRequirement(text), null, text);
    assert.ok(requirement(text).length > 0, text);
  }
});

// Only credentials a person holds are eligibility gates. A licence the business
// buys is an ordinary requirement.
test("a non-personal licence is not an eligibility gate", () => {
  for (const text of ["Music licenses", "Content license", "Business license"]) {
    assert.equal(isHardEligibility(text), false, text);
  }
  assert.ok(isHardEligibility("Professional license"));
  assert.ok(isHardEligibility("Active RN licensure"));
});

// A duty need not be imperative. When the subject is the person being hired,
// the sentence is about them whatever employer vocabulary follows.
test("a declarative candidate duty is kept", () => {
  for (const text of [
    "The candidate will manage the benefits package for all employees.",
    "The successful candidate will ensure Acme is an equal opportunity employer.",
    "You will own the annual compensation review.",
  ]) {
    assert.equal(classifyNonRequirement(text), null, text);
    assert.ok(requirement(text).length > 0, text);
  }
  // The EEO footer names applicants too, and is still employer prose.
  assert.ok(
    classifyNonRequirement(
      "All qualified applicants will receive consideration for employment without regard to race, color, or citizenship status."
    )
  );
});

// Protective prose must not span a comma into a denial, and being protected at
// all must not skip the denial check for the rest of the sentence.
test("a sponsorship denial after protective prose is still a gate", () => {
  assert.ok(isHardAuthorization("Regardless of location, no visa sponsorship is available for this role."));
  assert.ok(isHardAuthorization("We welcome applicants from all backgrounds, but sponsorship is not available."));
  assert.equal(isHardAuthorization("We welcome candidates who require sponsorship."), false);
});

// Only a known credential acronym marks a licence as personal.
test("an arbitrary acronym does not make a licence an eligibility gate", () => {
  for (const text of ["API license", "IP licenses", "TV license"]) {
    assert.equal(isHardEligibility(text), false, text);
  }
  assert.ok(isHardEligibility("Active RN licensure"));
  assert.ok(isHardEligibility("CPA license"));
});

// Clause scope, not span arithmetic. A protective clause speaks only for
// itself, so it can no longer cancel a demand or a denial beside it -- with or
// without punctuation separating them.
test("a protective clause cannot cancel a gate in a neighbouring clause", () => {
  for (const text of [
    "We encourage applicants but no sponsorship is available for this role.",
    "Regardless of location no visa sponsorship is available for this role.",
    "Regardless of location, no visa sponsorship is available for this role.",
    "We welcome applicants from all backgrounds, but sponsorship is not available.",
    "We do not require a degree, but require U.S. citizenship.",
  ]) {
    assert.ok(isHardAuthorization(text), text);
  }
  for (const text of [
    "We welcome candidates who require sponsorship.",
    "We welcome applicants with or without the need for visa sponsorship.",
    "Candidates requiring sponsorship will not be discriminated against.",
    "Regardless of immigration status, all applicants are welcome.",
  ]) {
    assert.equal(isHardAuthorization(text), false, text);
  }
});

// Quantified and modified candidate subjects are still candidate subjects.
test("a quantified candidate subject is not employer prose", () => {
  for (const text of [
    "Qualified candidates will manage the benefits package for all employees.",
    "Each applicant will ensure Acme is an equal opportunity employer.",
  ]) {
    assert.ok(requirement(text).length > 0, text);
  }
});

// The singular noun is as much a gate as the abstract one, and a terse bullet
// is the form a scraped posting most often uses.
test("a terse citizenship demand is a gate in either noun form", () => {
  for (const text of [
    "U.S. citizen required.",
    "US citizenship required",
    "Canadian citizens required",
    "Citizenship required.",
  ]) {
    assert.ok(isHardAuthorization(text), text);
  }
  assert.equal(
    isHardAuthorization("without regard to race, color, religion, or citizenship status"),
    false
  );
});

// Splitting is additive: it may add a gate, never remove one. A parenthetical
// between a modal and its object must not separate them.
test("a parenthetical clause does not separate a demand from its object", () => {
  for (const text of [
    "Candidates must, while employed, remain authorized to work in the United States.",
    "Applicants must, at the time of hire, be authorized to work in the US.",
    "You must, without exception, hold U.S. citizenship.",
  ]) {
    assert.ok(isHardAuthorization(text), text);
  }
});

// Protective prose is masked out rather than used to veto its clause, so a
// demand joined to it by "and" -- which introduces no contrast to split on --
// still survives.
test("protective prose does not swallow a demand joined to it", () => {
  assert.ok(
    isHardAuthorization(
      "We welcome candidates requiring sponsorship for other roles, and applicants for this position must be authorized to work in the United States."
    )
  );
  assert.equal(
    isHardAuthorization("We welcome candidates requiring sponsorship for other roles."),
    false
  );
});

// A welcome protects only the *need* for sponsorship. Masking a wider span than
// that swallowed the demand sharing the sentence with it.
test("a welcome does not protect an authorization demand beside it", () => {
  assert.ok(isHardAuthorization("We welcome applicants authorized to work without sponsorship."));
  assert.equal(
    isHardAuthorization("We encourage applicants needing visa sponsorship to apply."),
    false
  );
  // "requiring no sponsorship" is the negation of needing it, and is the gate.
  assert.ok(isHardAuthorization("We encourage applicants requiring no sponsorship to apply."));
});

// --- #26: eligibility gates must be attributed to the candidate -------------

test("administering credentials is a duty, not a gate", () => {
  assert.equal(
    isHardEligibility("Maintain professional license records and renewal dates for all clinicians."),
    false
  );
  assert.equal(
    isHardEligibility("Administer active medical license verification workflows."),
    false
  );
  assert.equal(isHardEligibility("Manage licensure for all clinical staff."), false);
});

test("a licence demanded of the reader is still a gate", () => {
  assert.ok(isHardEligibility("Active RN license required."));
  assert.ok(isHardEligibility("Must hold a valid professional license."));
  assert.ok(isHardEligibility("Professional license"));
});

// --- #27: employer process prose is not a candidate demand -----------------

test("employer verification prose is not a candidate gate", () => {
  assert.equal(
    isHardAuthorization(
      "As required by federal law, Acme verifies that all employees are authorized to work in the United States."
    ),
    false
  );
  assert.equal(isHardAuthorization("Acme participates in E-Verify."), false);
  // A real demand sharing the sentence still survives the mask.
  assert.ok(
    isHardAuthorization(
      "Acme verifies employment eligibility; candidates must be authorized to work in the United States."
    )
  );
});

test("authorization gates are detected outside the United States", () => {
  assert.ok(isHardAuthorization("Applicants must hold a valid EU work permit."));
  assert.ok(isHardAuthorization("You must have indefinite leave to remain in the UK."));
  assert.ok(isHardAuthorization("Candidates must have the right to work in the UK."));
});
