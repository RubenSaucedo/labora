import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateResumeClaims } from "../src/lib/validate-resume-claims.js";
import { STALE_DERIVED_RECORD, UNSUPPORTED_ASSERTION } from "../src/lib/diagnostic-class.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A persona whose generated records were built from the source as it stood, so
 * every check passes until something is deliberately moved out from under them.
 *
 * These fixtures pin the boundary that issue #86 was about: the validator must
 * distinguish "the evidence does not support this" from "profile/generated/ is
 * behind its source", because the first has no safe next step and the second
 * has a named owner and a known command. Collapsing them stopped review work
 * that never claimed release readiness.
 */
function fixture() {
  const personaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stale-record-persona-"));
  const sourcePath = path.join(personaRoot, "profile", "career.md");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(
    sourcePath,
    "Engineer — Example (2022 - Present)\nUsed React to reduce latency by 40%.\n"
  );
  const fileHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");

  const identity = {
    experience: [{
      id: "example-role",
      company: "Example",
      role: "Engineer",
      period: "2022 - Present",
    }],
    other_experience_compacted: [],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
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
      sources: [{ path: "profile/career.md", fileHash, lineStart: 1, lineEnd: 2 }],
    }],
  };
  const resume = {
    skills_primary: ["React"],
    skills_secondary: [],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
    experience: [{
      id: "example-role",
      company: "Example",
      role: "Engineer",
      period: "2022 - Present",
      bullets: ["Reduced latency by 40%"],
    }],
    provenance: {
      summaryClaimIds: [],
      bullets: [{ experienceId: "example-role", bulletIndex: 0, claimIds: ["claim-latency"] }],
      skills: [{ skill: "React", claimIds: ["claim-latency"] }],
    },
  };
  return { identity, bank, ledger, resume, workspaceRoot: personaRoot, personaRoot };
}

/** Move the human-authored source ahead of the generated records. */
function advanceSource(input, addition) {
  const sourcePath = path.join(input.personaRoot, "profile", "career.md");
  fs.appendFileSync(sourcePath, addition);
}

function errorsOf(result) {
  return result.issues.filter((issue) => issue.severity === "error");
}

test("a clean run reports no rebuild debt", () => {
  const result = validateResumeClaims(fixture());
  assert.equal(result.valid, true);
  assert.equal(result.state, "valid");
  assert.equal(result.rebuildPacket, null);
});

test("a source that moved ahead of profile/generated is stale, not fabrication", () => {
  const input = fixture();
  advanceSource(input, "AWS Certified Solutions Architect, Amazon Web Services, 2025.\n");
  input.resume.certifications = [{
    name: "AWS Certified Solutions Architect",
    issuer: "Amazon Web Services",
    year: "2025",
  }];

  const result = validateResumeClaims(input);

  assert.equal(result.valid, false, "a stale record still blocks release");
  assert.equal(result.state, "review_only");
  const unsupported = errorsOf(result).find((issue) => issue.code === "identity_section_unsupported");
  assert.ok(unsupported, "the catalog mismatch is still reported");
  assert.equal(unsupported.class, STALE_DERIVED_RECORD);
  assert.equal(unsupported.owner, "profile-builder");
  assert.equal(unsupported.requiredAction, "rebuild_profile");
  assert.ok(unsupported.blocks.includes("release"));
  assert.ok(unsupported.allows.includes("content_review"));
});

test("a hash mismatch does not cascade into an unsupported-content verdict", () => {
  const input = fixture();
  advanceSource(input, "Also mentored two engineers.\n");

  const result = validateResumeClaims(input);

  assert.equal(result.state, "review_only");
  const mismatch = errorsOf(result).find((issue) => issue.code === "source_hash_mismatch");
  assert.ok(mismatch);
  assert.equal(mismatch.class, STALE_DERIVED_RECORD);
  // The follow-on "no excerpt supports this claim" finding is caused by the
  // unreadable excerpt, so it must not be reported as a factual defect.
  for (const issue of errorsOf(result)) {
    assert.equal(issue.class, STALE_DERIVED_RECORD, `${issue.code} should be classified stale`);
  }
});

test("content the source never stated stays a hard factual failure", () => {
  const input = fixture();
  input.resume.certifications = [{
    name: "Certified Kubernetes Administrator",
    issuer: "Cloud Native Computing Foundation",
    year: "2024",
  }];

  const result = validateResumeClaims(input);

  assert.equal(result.valid, false);
  assert.equal(result.state, "invalid");
  const unsupported = errorsOf(result).find((issue) => issue.code === "identity_section_unsupported");
  assert.equal(unsupported.class, UNSUPPORTED_ASSERTION);
  assert.equal(result.rebuildPacket, null);
});

test("fabrication alongside a stale source never downgrades to review_only", () => {
  const input = fixture();
  advanceSource(input, "AWS Certified Solutions Architect, Amazon Web Services, 2025.\n");
  input.resume.certifications = [
    { name: "AWS Certified Solutions Architect", issuer: "Amazon Web Services", year: "2025" },
    { name: "Certified Kubernetes Administrator", issuer: "Cloud Native Computing Foundation", year: "2024" },
  ];

  const result = validateResumeClaims(input);

  assert.equal(result.state, "invalid", "one unsupported entry poisons the whole catalog check");
});

test("an edited source alone does not excuse an invented degree", () => {
  const input = fixture();
  advanceSource(input, "Also mentored two engineers.\n");
  input.resume.education = [{ school: "Stanford University", degree: "PhD Computer Science", endDate: "2019" }];

  const result = validateResumeClaims(input);

  assert.equal(result.state, "invalid");
  const mismatch = errorsOf(result).find((issue) => issue.code === "identity_section_mismatch");
  assert.equal(mismatch.class, UNSUPPORTED_ASSERTION);
});

test("the rebuild packet names one owner, one action and every stale record", () => {
  const input = fixture();
  advanceSource(input, "AWS Certified Solutions Architect, Amazon Web Services, 2025.\n");
  input.resume.certifications = [{
    name: "AWS Certified Solutions Architect",
    issuer: "Amazon Web Services",
    year: "2025",
  }];

  const packet = validateResumeClaims(input).rebuildPacket;

  assert.equal(packet.owner, "profile-builder");
  assert.equal(packet.requiredAction, "rebuild_profile");
  assert.deepEqual(packet.blocks, ["release", "judges", "docx", "pdf"]);
  assert.ok(packet.records.length >= 2, "the source and the catalog entry are both reported");
  // Deterministic ordering, so two runs over the same inputs plan the same rebuild.
  const codes = packet.records.map((record) => `${record.code}${record.location}`);
  assert.deepEqual(codes, [...codes].sort((a, b) => a.localeCompare(b)));
});

test("the CLI separates a rebuild exit from a factual-failure exit", () => {
  const input = fixture();
  advanceSource(input, "AWS Certified Solutions Architect, Amazon Web Services, 2025.\n");
  input.resume.certifications = [{
    name: "AWS Certified Solutions Architect",
    issuer: "Amazon Web Services",
    year: "2025",
  }];

  const dir = input.personaRoot;
  // The persona root is derived from the identity path, so the on-disk fixture
  // must use the real layout: generated records under profile/generated/, and
  // the resume in an application directory beside them.
  const generated = path.join(dir, "profile", "generated");
  const application = path.join(dir, "applications", "example-job");
  fs.mkdirSync(generated, { recursive: true });
  fs.mkdirSync(application, { recursive: true });
  // The CLI parses against the full tailored-resume schema, so the on-disk
  // fixture carries the fields the in-process helper does not require.
  const cliResume = {
    schema_version: "3.0",
    target_role: "Engineer",
    ats_title: "Engineer",
    contact: { name: "", email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" },
    summary: "",
    keywords_mapped: [],
    gaps_or_risks: [],
    notes_for_human: [],
    ...input.resume,
  };
  const cliLedger = {
    schemaVersion: "1.0",
    persona: "stale-fixture",
    generatedAt: "2026-01-01T00:00:00.000Z",
    claims: input.ledger.claims.map((claim) => ({
      type: "metric",
      period: "",
      ...claim,
      sources: claim.sources.map((source) => ({
        page: null,
        extraction: "markdown",
        confidence: 1,
        ...source,
      })),
    })),
  };
  const write = (target, value) => {
    fs.writeFileSync(target, JSON.stringify(value));
    return target;
  };
  const resumePath = write(path.join(application, "resume.json"), cliResume);
  const identityPath = write(path.join(generated, "identity.json"), {
    schema_version: "4.0",
    contact: { name: "", email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" },
    legacy_skills: [],
    ...input.identity,
  });
  const ledgerPath = write(path.join(generated, "claims.json"), cliLedger);
  // The bank is optional to the library but supplies the skill vocabulary, so
  // the on-disk fixture carries one rather than letting "React" read as an
  // unvouched skill and mask the exit code under test.
  write(path.join(generated, "accomplishments.json"), {
    schemaVersion: "1.0",
    persona: "stale-fixture",
    units: [{
      id: "unit-example",
      experienceId: "example-role",
      title: "Dashboard latency work",
      kind: "platform",
      startDate: "2022-03",
      endDate: "2023-06",
      ongoing: false,
      contribution: "tech_lead",
      scope: {
        surface: "dashboard",
        audience: "business users",
        repos: [],
        partnerTeams: [],
        productionExposure: "shipped_ga",
      },
      techStack: ["react"],
      outcomes: [{
        claimId: "claim-latency",
        metric: "page_load_time",
        direction: "reduced",
        confidence: "production_measured",
      }],
      evidenceStrength: {
        tier: "strong",
        sourceKinds: ["performance_review"],
        artifactCount: 1,
        corroboratingSources: 1,
        limitations: [],
      },
      disclosure: "public",
      claimIds: ["claim-latency"],
      supersedes: [],
    }],
  });

  const run = () => {
    const args = [
      path.join(repoRoot, "src", "tools", "validate-claims.js"),
      resumePath,
      identityPath,
      ledgerPath,
    ];
    try {
      const stdout = execFileSync(process.execPath, args, {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, stderr: "", stdout };
    } catch (error) {
      return { code: error.status, stderr: String(error.stderr || ""), stdout: String(error.stdout || "") };
    }
  };

  const unexpected = (result) => {
    try {
      return JSON.parse(result.stdout).issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.class}:${issue.code}`)
        .join(", ");
    } catch {
      return result.stderr;
    }
  };

  const stale = run();
  assert.equal(stale.code, 3, `a stale record exits 3, not the factual-failure 2: ${stale.stderr}`);
  assert.match(stale.stderr, /PROFILE REBUILD REQUIRED/);
  assert.match(stale.stderr, /profile-builder/);
  assert.match(stale.stderr, /UNVALIDATED/);

  input.resume.certifications.push({
    name: "Certified Kubernetes Administrator",
    issuer: "Cloud Native Computing Foundation",
    year: "2024",
  });
  write(resumePath, { ...cliResume, certifications: input.resume.certifications });
  const invalid = run();
  assert.equal(invalid.code, 2, "unsupported content keeps the original hard-failure exit");
  assert.doesNotMatch(invalid.stderr, /PROFILE REBUILD REQUIRED/);
});
