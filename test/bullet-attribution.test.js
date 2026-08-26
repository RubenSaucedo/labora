import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { validateResumeClaims } from "../src/lib/validate-resume-claims.js";
import { evaluateQualityGate } from "../src/lib/quality-gate.js";

/**
 * Issue #85. Bullet provenance is one claim list for the whole bullet, and the
 * validator joins every mapped claim into a single blob before checking it.
 * That proves the words exist somewhere in the mapped claims. It never proves
 * the outcome belongs to the subject it modifies, so a bullet can move a result
 * from one record onto another's subject and pass every check.
 *
 * The fix does not claim such a bullet is false -- no lexical validator can
 * establish a grammatical relationship. It stops claiming the bullet was
 * verified when only the union was checked.
 */

const SOURCE = [
  "Engineer - Example (2022 - Present)",
  "Led the Example Agent rollout to private preview.",
  "A separate admin treatment reached full allocation.",
].join("\n");

function fixture({ bullet, claimIds }) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "labora-attribution-"));
  const sourcePath = path.join(workspaceRoot, "profile", "career.md");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, SOURCE);
  const fileHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
  const source = (lineStart, lineEnd) => [{ path: "profile/career.md", fileHash, lineStart, lineEnd }];

  return {
    workspaceRoot,
    personaRoot: workspaceRoot,
    identity: {
      experience: [{ id: "example-role", company: "Example", role: "Engineer", period: "2022 - Present" }],
      other_experience_compacted: [],
      skill_vetoes: [],
    },
    bank: { units: [{ id: "unit-example", experienceId: "example-role", techStack: [], claimIds }] },
    ledger: {
      claims: [
        {
          id: "claim-preview",
          fact: "Led the Example Agent rollout to private preview.",
          status: "verified",
          disclosure: "public",
          sources: source(2, 2),
        },
        {
          id: "claim-allocation",
          fact: "A separate admin treatment reached full allocation.",
          status: "verified",
          disclosure: "public",
          sources: source(3, 3),
        },
      ],
    },
    resume: {
      skills_primary: [],
      skills_secondary: [],
      experience: [{
        id: "example-role",
        company: "Example",
        role: "Engineer",
        period: "2022 - Present",
        bullets: Array.isArray(bullet) ? bullet : [bullet],
      }],
      provenance: {
        summaryClaimIds: [],
        bullets: (Array.isArray(claimIds[0]) ? claimIds : [claimIds]).map((ids, bulletIndex) => ({
          experienceId: "example-role",
          bulletIndex,
          claimIds: ids,
        })),
        skills: [],
      },
    },
  };
}

const attribution = (result) =>
  result.issues.filter((i) => i.code === "bullet_attribution_unverified");

test("the union of two claims no longer certifies a relationship neither states", () => {
  // Every substantive term exists across the two claims, so the union check
  // passes -- but the sentence moves `full allocation` onto the Example Agent.
  const result = validateResumeClaims(fixture({
    bullet: "Led the Example Agent rollout to full allocation.",
    claimIds: ["claim-preview", "claim-allocation"],
  }));
  const found = attribution(result);
  assert.equal(found.length, 1, JSON.stringify(result.issues, null, 2));
  assert.equal(found[0].severity, "warning");
});

test("the report names which claim is missing which terms, so a reader sees the split", () => {
  const result = validateResumeClaims(fixture({
    bullet: "Led the Example Agent rollout to full allocation.",
    claimIds: ["claim-preview", "claim-allocation"],
  }));
  const message = attribution(result)[0].message;
  assert.match(message, /claim-preview does not cover: .*allocation/);
  assert.match(message, /claim-allocation does not cover: .*(agent|rollout)/);
  assert.match(message, /composition is unverified/);
});

test("it reports uncertainty, never a claim that the bullet is false", () => {
  const result = validateResumeClaims(fixture({
    bullet: "Led the Example Agent rollout to full allocation.",
    claimIds: ["claim-preview", "claim-allocation"],
  }));
  // A warning keeps `valid` true. Labora did not establish the relationship;
  // that is not the same as establishing it is wrong, and saying so would be
  // exactly the overreach this fix removes.
  assert.equal(attribution(result)[0].severity, "warning");
  assert.ok(!result.issues.some((i) => i.code === "bullet_attribution_unverified" && i.severity === "error"));
});

test("a single-claim bullet carries no ceremony, because the union is that claim", () => {
  const result = validateResumeClaims(fixture({
    bullet: "Led the Example Agent rollout to private preview.",
    claimIds: ["claim-preview"],
  }));
  assert.deepEqual(attribution(result), []);
});

test("splitting the statement so each bullet rests on one record clears the finding", () => {
  const result = validateResumeClaims(fixture({
    bullet: [
      "Led the Example Agent rollout to private preview.",
      "Supported a separate admin treatment that reached full allocation.",
    ],
    claimIds: [["claim-preview"], ["claim-allocation"]],
  }));
  assert.deepEqual(attribution(result), []);
});

test("two claims are fine when one of them carries the whole statement alone", () => {
  // Multi-claim mapping is not itself the defect. Distributed support is.
  const result = validateResumeClaims(fixture({
    bullet: "Led the Example Agent rollout to private preview.",
    claimIds: ["claim-preview", "claim-allocation"],
  }));
  assert.deepEqual(attribution(result), []);
});

test("the release gate reports the finding as uncertain, not unsupported", () => {
  const result = validateResumeClaims(fixture({
    bullet: "Led the Example Agent rollout to full allocation.",
    claimIds: ["claim-preview", "claim-allocation"],
  }));
  const release = evaluateQualityGate({
    artifactHash: "a".repeat(64),
    artifactPath: "r.docx",
    artifactType: "docx",
    claimValidation: result,
  });
  const finding = release.findings.find((f) => f.code === "bullet_attribution_unverified");
  assert.ok(finding, JSON.stringify(release.findings, null, 2));
  assert.equal(finding.status, "uncertain");
  assert.equal(release.state, "review_ready");
});
