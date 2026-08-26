import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { validateResumeClaims } from "../src/lib/validate-resume-claims.js";
import { validateApplicationStrategy } from "../src/lib/application-strategy.js";
import { ZClaimLedger } from "../src/schemas/provenance.js";

function fixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "resume-claim-fixture-"));
  const sourcePath = path.join(workspaceRoot, "profile", "career.md");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, "Engineer — Example (2022 - Present)\nUsed React to reduce latency by 40%.");
  const fileHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
  const identity = {
    experience: [{
      id: "example-role",
      company: "Example",
      role: "Engineer",
      period: "2022 - Present",
    }],
    other_experience_compacted: [],
    skill_vetoes: [],
  };
  const bank = {
    units: [{
      id: "unit-example",
      experienceId: "example-role",
      techStack: ["react"],
      claimIds: ["claim-latency"],
    }],
  };
  const ledger = {
    claims: [{
      id: "claim-latency",
      fact: "Used React to reduce latency by 40%.",
      status: "verified",
      disclosure: "public",
      sources: [{
        path: "profile/career.md",
        fileHash,
        lineStart: 1,
        lineEnd: 2,
      }],
    }],
  };
  const resume = {
    skills_primary: ["React"],
    skills_secondary: [],
    experience: [{
      id: "example-role",
      company: "Example",
      role: "Engineer",
      period: "2022 - Present",
      bullets: ["Reduced latency by 40%"],
    }],
    provenance: {
      summaryClaimIds: [],
      bullets: [{
        experienceId: "example-role",
        bulletIndex: 0,
        claimIds: ["claim-latency"],
      }],
      skills: [{
        skill: "React",
        claimIds: ["claim-latency"],
      }],
    },
  };
  return { identity, bank, ledger, resume, workspaceRoot, personaRoot: workspaceRoot };
}

test("accepts fully mapped verified claims", () => {
  const result = validateResumeClaims(fixture());
  assert.equal(result.valid, true);
});

test("a rendered experience location must match the identity record", () => {
  const input = fixture();
  input.identity.experience[0].location = "Austin, TX";
  input.resume.experience[0].location = "Seattle, WA";

  const result = validateResumeClaims(input);

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) =>
    issue.code === "experience_identity_changed"
    && issue.location === "experience[0].location"
  ));
});

test("rejects claims grounded in story.md now that it is not an approved source", () => {
  const input = fixture();
  const storyPath = path.join(input.workspaceRoot, "profile", "story.md");
  fs.writeFileSync(storyPath, "Engineer — Example (2022 - Present)\nUsed React to reduce latency by 40%.");
  const fileHash = crypto.createHash("sha256").update(fs.readFileSync(storyPath)).digest("hex");
  input.ledger.claims[0].sources = [{
    path: "profile/story.md",
    fileHash,
    lineStart: 1,
    lineEnd: 2,
  }];
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "source_not_approved"), true);
});

test("rejects unsupported numeric claims", () => {
  const input = fixture();
  input.resume.experience[0].bullets[0] = "Reduced latency by 75%";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "unsupported_number"), true);
});

test("rejects repeated use of one achievement as multiple bullets", () => {
  const input = fixture();
  input.resume.experience[0].bullets.push("Improved latency by 40%");
  input.resume.provenance.bullets.push({
    experienceId: "example-role",
    bulletIndex: 1,
    claimIds: ["claim-latency"],
  });
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "duplicate_claim_usage"), true);
});

test("rejects a claim when its source file changed", () => {
  const input = fixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-claims-"));
  fs.mkdirSync(path.join(root, "profile"), { recursive: true });
  fs.writeFileSync(path.join(root, "profile", "career.md"), "Original source");
  input.ledger.claims[0].sources = [{
    path: "profile/career.md",
    fileHash: "not-the-current-hash",
    lineStart: 1,
    lineEnd: 1,
  }];
  const result = validateResumeClaims({ ...input, workspaceRoot: root, personaRoot: root });
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "source_hash_mismatch"), true);
});

test("rejects semantically unrelated bullet and skill mappings", () => {
  const input = fixture();
  input.ledger.claims[0].fact = "Maintained internal documentation.";
  input.resume.experience[0].bullets[0] = "Migrated production workloads to Kubernetes";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) =>
    ["unsupported_technology", "claim_content_mismatch", "skill_claim_mismatch"].includes(issue.code)
  ), true);
});

test("rejects synchronized claim and bullet fabrication absent from the source", () => {
  const input = fixture();
  input.ledger.claims[0].fact = "Increased revenue by 99%.";
  input.resume.experience[0].bullets[0] = "Increased revenue by 99%";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "claim_source_mismatch"), true);
});

test("rejects an unknown technology substituted into a claim", () => {
  const input = fixture();
  input.ledger.claims[0].fact = "Used SvelteKit to reduce latency by 40%.";
  input.resume.experience[0].bullets[0] = "Used SvelteKit to reduce latency by 40%";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "claim_source_mismatch"), true);
});

test("rejects an unknown technology substituted into a bullet", () => {
  const input = fixture();
  input.resume.experience[0].bullets[0] = "Used SvelteKit to reduce latency by 40%";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "unsupported_technology"), true);
});

test("rejects unsupported summary and invented structured sections", () => {
  const input = fixture();
  input.resume.summary = "AWS architect who increased revenue by 900%.";
  input.resume.provenance.summaryClaimIds = [];
  input.resume.provenance.summary = [{
    sentenceIndex: 0,
    text: input.resume.summary,
    clauses: [{
      text: input.resume.summary,
      claimIds: ["claim-latency"],
      unitIds: ["unit-example"],
    }],
  }];
  input.resume.target_role = "Engineer";
  input.resume.ats_title = "Engineer | AWS";
  input.resume.education = [{
    school: "Invented University",
    degree: "PhD",
    location: "",
    startDate: "",
    endDate: "2025",
  }];
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "summary_claim_mismatch"), true);
  assert.equal(result.issues.some((issue) => issue.code === "identity_section_mismatch"), true);
});

test("rejects claims sourced from outside the active persona", () => {
  const input = fixture();
  const otherSource = path.join(input.workspaceRoot, "data", "personas", "other", "profile", "career.md");
  fs.mkdirSync(path.dirname(otherSource), { recursive: true });
  fs.writeFileSync(otherSource, "Engineer — Example (2022 - Present)\nUsed React to reduce latency by 40%.");
  input.ledger.claims[0].sources[0] = {
    path: path.relative(input.workspaceRoot, otherSource),
    fileHash: crypto.createHash("sha256").update(fs.readFileSync(otherSource)).digest("hex"),
    lineStart: 1,
    lineEnd: 2,
  };
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "source_not_approved"), true);
});

test("rejects identity-record employment invented without structured source support", () => {
  const input = fixture();
  input.identity.experience[0].role = "Chief Executive Officer";
  input.resume.experience[0].role = "Chief Executive Officer";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "identity_experience_unproven"), true);
});

test("validates identity-record structured entries even when tailored experience is empty", () => {
  const input = fixture();
  input.resume.experience = [];
  input.resume.provenance.bullets = [];
  input.identity.education = [{
    school: "Invented University",
    degree: "PhD",
    location: "",
    startDate: "",
    endDate: "2025",
  }];
  input.resume.education = structuredClone(input.identity.education);
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "identity_record_unproven"), true);
});

test("generalized wording renders when the internal fact carries a codename", () => {
  const input = fixture();
  const claim = input.ledger.claims[0];
  claim.fact = "Used React on Projectbluebird to reduce latency by 40%.";
  claim.disclosure = "internal_generalizable";
  claim.externalFact = "Used React to reduce latency by 40%.";
  fs.writeFileSync(
    path.join(input.workspaceRoot, "profile", "career.md"),
    "Engineer — Example (2022 - Present)\nUsed React on Projectbluebird to reduce latency by 40%."
  );
  claim.sources[0].fileHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(input.workspaceRoot, "profile", "career.md")))
    .digest("hex");
  const result = validateResumeClaims(input);
  assert.equal(result.valid, true);
  assert.equal(result.issues.some((issue) => issue.code === "unsupported_technology"), false);
});

test("internal_only claims may never ground rendered content", () => {
  const input = fixture();
  input.ledger.claims[0].disclosure = "internal_only";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "confidential_claim_rendered"), true);
});

test("an unclassified claim may not ground rendered resume content", () => {
  const input = fixture();
  delete input.ledger.claims[0].disclosure;
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "claim_disclosure_unclassified"), true);
  assert.equal(result.issues.some((issue) => issue.code === "confidential_claim_rendered"), false);
});

test("internal_generalizable claims require an externalFact", () => {
  const input = fixture();
  input.ledger.claims[0].disclosure = "internal_generalizable";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "external_fact_missing"), true);
});

test("externalFact cannot smuggle numbers or technologies past the internal fact", () => {
  const input = fixture();
  const claim = input.ledger.claims[0];
  claim.disclosure = "internal_generalizable";
  claim.externalFact = "Used Kubernetes to reduce latency by 90% for 40M users.";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "external_fact_ungrounded"), true);
});

test("externalFact cannot contain editorial instructions", () => {
  const input = fixture();
  const claim = input.ledger.claims[0];
  claim.disclosure = "internal_generalizable";
  claim.externalFact =
    "The defensible one-line statement is: used React to reduce latency by 40%.";

  const result = validateResumeClaims(input);

  assert.equal(result.valid, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "external_fact_editorial_instruction"),
    true
  );
});

test("externalFact must remain substantively supported without rejecting factual verbs", () => {
  const unsupported = fixture();
  unsupported.ledger.claims[0].disclosure = "internal_generalizable";
  unsupported.ledger.claims[0].externalFact =
    "Improved collaboration and strategic execution across teams.";

  const unsupportedResult = validateResumeClaims(unsupported);

  assert.equal(unsupportedResult.valid, false);
  assert.equal(
    unsupportedResult.issues.some((issue) => issue.code === "external_fact_substantive_mismatch"),
    true
  );

  const factual = fixture();
  const claim = factual.ledger.claims[0];
  claim.fact = "Led delivery, built a React cache, and reduced request latency by 40%.";
  claim.disclosure = "internal_generalizable";
  claim.externalFact =
    "Led delivery, built a React cache, and reduced request latency by 40%.";
  const sourcePath = path.join(factual.workspaceRoot, "profile", "career.md");
  fs.writeFileSync(
    sourcePath,
    "Engineer — Example (2022 - Present)\nLed delivery, built a React cache, and reduced request latency by 40%."
  );
  claim.sources[0].fileHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(sourcePath))
    .digest("hex");

  const factualResult = validateResumeClaims(factual);

  assert.equal(factualResult.valid, true);
  assert.equal(
    factualResult.issues.some((issue) =>
      ["external_fact_editorial_instruction", "external_fact_substantive_mismatch"]
        .includes(issue.code)
    ),
    false
  );
});

test("claim parse preserves disclosure-key presence without disclosure backfill", () => {
  const source = {
    path: "profile/background.md",
    fileHash: "6cabd91d13b54c7e1b9edc224595e9917615739fef409c406e1a0e6d24983756",
    lineStart: 1,
    lineEnd: 2,
    page: null,
    extraction: "markdown",
    confidence: 1,
  };
  const raw = {
    schemaVersion: "1.0",
    persona: "example",
    claims: [
      {
        id: "claim-unclassified",
        type: "achievement",
        fact: "Built React dashboards.",
        period: "",
        status: "verified",
        sources: [source],
      },
      {
        id: "claim-classified",
        type: "achievement",
        fact: "Built TypeScript services.",
        period: "",
        status: "verified",
        disclosure: "public",
        sources: [source],
      },
    ],
  };

  const parsed = ZClaimLedger.parse(raw);
  for (const [index, claim] of parsed.claims.entries()) {
    const original = raw.claims[index];
    assert.equal(("disclosure" in claim), ("disclosure" in original));
    assert.equal(claim.id, original.id);
    assert.equal(claim.fact, original.fact);
    assert.deepEqual(claim.sources, original.sources);
    assert.deepEqual(
      claim.sources.map((entry) => entry.fileHash),
      original.sources.map((entry) => entry.fileHash),
    );
  }

  const backfilled = parsed.claims.filter((claim, index) =>
    !("disclosure" in raw.claims[index]) && ("disclosure" in claim)
  );
  assert.deepEqual(backfilled, []);
});

test("application strategy output is unchanged by claim disclosure presence", () => {
  const strategy = {
    status: "ready",
    topSignals: [{ requirementIds: ["req-001"], claimIds: ["claim-1"] }],
    likelyConcerns: [],
    evidenceRequests: [],
    firstPagePlan: { leadClaimIds: ["claim-1"] },
  };
  const jobSpec = {
    requirements: [{ id: "req-001", severity: "core", text: "React experience" }],
  };
  const claim = { id: "claim-1", status: "verified", fact: "Built React applications." };

  const withDisclosure = validateApplicationStrategy({
    strategy,
    jobSpec,
    claimLedger: { claims: [{ ...claim, disclosure: "public" }] },
  });
  const withoutDisclosure = validateApplicationStrategy({
    strategy,
    jobSpec,
    claimLedger: { claims: [claim] },
  });

  assert.deepEqual(withoutDisclosure, withDisclosure);
});

// --- profile split: contact.md must never ground claims -------------------
// Claims are anchored to their source by content hash, so a file that is edited
// routinely (contact details) must be kept out of the grounding corpus or a new
// phone number would silently invalidate the ledger.

function groundedIn(relativePath) {
  const input = fixture();
  const sourcePath = path.join(input.workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, "Engineer — Example (2022 - Present)\nUsed React to reduce latency by 40%.");
  const claim = input.ledger.claims[0];
  claim.sources[0].path = relativePath;
  claim.sources[0].fileHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(sourcePath))
    .digest("hex");
  return validateResumeClaims(input);
}

test("background.md is an approved claim-grounding source", () => {
  const result = groundedIn("profile/background.md");
  assert.equal(result.issues.some((issue) => issue.code === "source_not_approved"), false);
});

test("contact.md is rejected as a claim-grounding source", () => {
  const result = groundedIn("profile/contact.md");
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "source_not_approved"), true);
});

test("editing contact.md cannot invalidate claims grounded in background.md", () => {
  const input = fixture();
  const background = path.join(input.workspaceRoot, "profile", "background.md");
  fs.writeFileSync(background, "Engineer — Example (2022 - Present)\nUsed React to reduce latency by 40%.");
  const claim = input.ledger.claims[0];
  claim.sources[0].path = "profile/background.md";
  claim.sources[0].fileHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(background))
    .digest("hex");
  assert.equal(validateResumeClaims(input).valid, true);

  // The contact card changes; the ledger must be unaffected.
  fs.writeFileSync(path.join(input.workspaceRoot, "profile", "contact.md"), "- Phone: +1 555-000-9999");
  const after = validateResumeClaims(input);
  assert.equal(after.valid, true);
  assert.equal(after.issues.some((issue) => issue.code === "source_hash_mismatch"), false);
});

// --- catalog sections: identity is a superset the tailor selects from -----
// Certifications, projects and awards accumulate over a career. The identity
// record holds every verified one; each resume renders only those relevant to
// the job. The gate therefore enforces containment (nothing rendered that is
// not verified) rather than equality (which would force every entry onto every
// resume). Education stays exact: a degree is not a per-job selection.

function certFixture() {
  const input = fixture();
  const background = path.join(input.workspaceRoot, "profile", "background.md");
  fs.writeFileSync(background, "MICROSOFT SKILLUP AI\nMicrosoft | Issued March 2024");
  input.ledger.claims.push({
    id: "claim-cert-skillup",
    fact: "MICROSOFT SKILLUP AI. Microsoft | Issued March 2024.",
    status: "verified",
    disclosure: "public",
    sources: [{
      path: "profile/background.md",
      fileHash: crypto.createHash("sha256").update(fs.readFileSync(background)).digest("hex"),
      lineStart: 1,
      lineEnd: 2,
    }],
  });
  input.identity.certifications = [{
    name: "MICROSOFT SKILLUP AI",
    issuer: "Microsoft",
    year: "2024",
    credential_url: "https://www.credly.com/badges/00000000-0000-0000-0000-000000000000/linked_in_profile",
  }];
  return input;
}

const sectionIssues = (result) =>
  result.issues.filter((issue) => issue.code.startsWith("identity_section"));

test("a resume may omit certifications held in the identity record", () => {
  const input = certFixture();
  input.resume.certifications = [];
  assert.deepEqual(sectionIssues(validateResumeClaims(input)), []);
});

test("a resume may render a certification present in the identity record", () => {
  const input = certFixture();
  input.resume.certifications = [...input.identity.certifications];
  assert.deepEqual(sectionIssues(validateResumeClaims(input)), []);
});

test("a resume may not render a certification absent from the identity record", () => {
  const input = certFixture();
  input.resume.certifications = [
    ...input.identity.certifications,
    { name: "AWS Certified Solutions Architect", issuer: "AWS", year: "2024" },
  ];
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  const codes = sectionIssues(result).map((issue) => issue.code);
  assert.deepEqual(codes, ["identity_section_unsupported"]);
});

test("a resume may not duplicate a certification to pad the section", () => {
  const input = certFixture();
  const cert = input.identity.certifications[0];
  input.resume.certifications = [cert, { ...cert }];
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false);
  assert.equal(sectionIssues(result)[0].code, "identity_section_unsupported");
});

test("education must still match the identity record exactly", () => {
  const input = certFixture();
  input.identity.education = [{ school: "Example University", degree: "BSc", endDate: "2018" }];
  input.resume.education = [];
  const codes = sectionIssues(validateResumeClaims(input)).map((issue) => issue.code);
  assert.deepEqual(codes, ["identity_section_mismatch"]);
});

// --- repository snapshots as machine-retrievable evidence -----------------
// Repository facts are re-fetchable, so a reviewer can diff a snapshot against
// live GitHub. Only the file `snapshot-repos.js` produces may ground claims, so
// a hand-written file cannot enter the corpus under a name the tool never emits.

test("a repository snapshot is an approved claim-grounding source", () => {
  const result = groundedIn("evidence/repositories/2026-08-01/repositories.md");
  assert.equal(result.issues.some((issue) => issue.code === "source_not_approved"), false);
});

test("an arbitrary file beside a repository snapshot cannot ground claims", () => {
  const result = groundedIn("evidence/repositories/2026-08-01/notes.md");
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "source_not_approved"), true);
});

test("evidence outside the approved categories still cannot ground claims", () => {
  const result = groundedIn("evidence/references/recommendation.md");
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === "source_not_approved"), true);
});

// The headline used to be the least-validated field in the artifact: every
// other assertion was checked for claim support, the headline for a substring.
// These cover the validator wiring; test/headline.test.js covers the analysis
// itself and runs without dependencies installed.

test("a headline that drops the target role warns instead of blocking", () => {
  const input = fixture();
  input.resume.target_role = "Software Engineer";
  input.resume.ats_title = "React Engineer";
  const result = validateResumeClaims(input);
  const finding = result.issues.find((issue) => issue.code === "ats_title_role_mismatch");
  assert.equal(finding.severity, "warning", "a contested formatting convention must not block");
  assert.equal(
    result.issues.some((issue) => issue.severity === "error" && issue.location === "ats_title"),
    false
  );
});

test("the headline is still blocked from asserting an unsupported skill", () => {
  const input = fixture();
  input.resume.target_role = "Engineer";
  input.resume.ats_title = "Engineer | AWS";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, false, "fabricated capability is what error severity is for");
  assert.equal(result.issues.some((issue) => issue.code === "ats_title_unsupported_skill"), true);
});

test("an unmapped headline qualifier warns rather than failing to parse", () => {
  const input = fixture();
  input.resume.target_role = "Engineer";
  input.resume.ats_title = "Engineer, React";
  const result = validateResumeClaims(input);
  assert.equal(result.valid, true, "a resume tailored before the field existed is stale, not invalid");
  assert.equal(
    result.issues.find((issue) => issue.code === "headline_term_unmapped")?.severity,
    "warning"
  );
});

test("mapping a headline qualifier to a verified claim clears the warning", () => {
  const input = fixture();
  input.resume.target_role = "Engineer";
  input.resume.ats_title = "Engineer, React";
  input.resume.provenance.headline = [{ term: "React", claimIds: ["claim-latency"] }];
  const result = validateResumeClaims(input);
  assert.equal(result.valid, true);
  assert.equal(result.issues.some((issue) => issue.code.startsWith("headline_term_un")), false);
});

test("no headline finding can ever block a release", () => {
  const input = fixture();
  input.resume.target_role = "Engineer";
  input.resume.ats_title = "Engineer, React, Latency";
  const result = validateResumeClaims(input);
  const headlineFindings = result.issues.filter((issue) => issue.code.startsWith("headline_"));
  assert.ok(headlineFindings.length > 0);
  assert.equal(headlineFindings.some((issue) => issue.severity === "error"), false);
});

test("info findings are counted apart from warnings", () => {
  const input = fixture();
  input.resume.target_role = "Engineer";
  input.resume.ats_title = "Engineer, React";
  const result = validateResumeClaims(input);
  assert.equal(
    result.warningCount,
    result.issues.filter((issue) => issue.severity === "warning").length
  );
  assert.equal(
    result.infoCount,
    result.issues.filter((issue) => issue.severity === "info").length
  );
  assert.equal(result.errorCount + result.warningCount + result.infoCount, result.issues.length);
});
