import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  COLD_READER_INPUT_KEYS,
  coldReaderFindings,
  deterministicReaderRisks,
  hashColdReaderInput,
  prepareColdReaderInput,
  privateContextLeaks,
  reportMatchesInput,
} from "../src/lib/reader-context.js";
import { ZColdReaderInput, ZColdReaderReport } from "../src/schemas/reader-review.js";
import { resumeToText } from "../src/lib/resume-to-text.js";

import { approvedBaseline, claimLedger, accomplishmentBank, withBullets } from "./fixtures/editorial.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The cold reader sees the document and the posting. That is the feature.
 *
 * A reviewer who knows what the author meant will understand a sentence a
 * recruiter will not, and will report that the sentence is clear. The isolation
 * is therefore not a precaution around the check; it *is* the check.
 */

/* ------------------------------------------------------ required item 13 */

test("the cold reader receives no evidence corpus or private context", () => {
  const resume = approvedBaseline();
  const input = prepareColdReaderInput({
    resumeText: resumeToText(resume),
    postingText: "Senior Platform Engineer. TypeScript. Docker. Automated testing.",
    audience: "engineering_manager",
  });

  assert.deepEqual(Object.keys(input).sort(), [...COLD_READER_INPUT_KEYS].sort());
  assert.deepEqual(privateContextLeaks(input), []);

  // Positive control: the leak detector has to actually detect, or the
  // assertion above stays green after the guarantee it describes has broken.
  assert.deepEqual(
    privateContextLeaks({ resumeText: "x", claimLedger: { claims: [] } }),
    ["input.claimLedger", "input.claimLedger.claims"],
  );
  assert.deepEqual(
    privateContextLeaks({ resumeText: "x", nested: { provenance: {} } }),
    ["input.nested.provenance"],
  );

  // The text itself must not smuggle provenance through. `resumeToText` renders
  // what a reader sees; the claim IDs live only in the JSON.
  for (const claim of claimLedger.claims) {
    assert.ok(!input.resumeText.includes(claim.id), `claim id ${claim.id} reached the cold reader`);
  }
  for (const unit of accomplishmentBank.units) {
    assert.ok(!input.resumeText.includes(unit.id), `unit id ${unit.id} reached the cold reader`);
  }
});

test("there is nowhere to put private context even when it is offered", () => {
  const smuggled = prepareColdReaderInput({
    resumeText: "Software engineer.",
    postingText: "Platform role.",
    audience: "recruiter",
    // Every one of these is dropped: the function has no parameter for them and
    // the schema is strict, so the isolation cannot be undone by a caller.
    claimLedger,
    accomplishments: accomplishmentBank,
    strategy: { candidateNarrative: "lead with the pipeline" },
    glossary: { "private preview": "an internal test" },
    provenance: { bullets: [] },
  });

  assert.deepEqual(Object.keys(smuggled).sort(), [...COLD_READER_INPUT_KEYS].sort());
  assert.deepEqual(privateContextLeaks(smuggled), []);
  assert.equal(ZColdReaderInput.safeParse({ ...smuggled, claims: [] }).success, false);
});

test("the tool that builds the reader's world refuses to emit leaked context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-reader-"));
  const textPath = path.join(root, "artifact.txt");
  const jobPath = path.join(root, "job.md");
  fs.writeFileSync(textPath, resumeToText(approvedBaseline()), "utf8");
  fs.writeFileSync(jobPath, "# Senior Platform Engineer\n\nTypeScript, Docker, automated testing.\n", "utf8");

  const result = spawnSync(process.execPath, [
    path.join(ROOT, "bin", "labora"), "prepare-reader-input", textPath,
    "--job", jobPath, "--audience", "recruiter",
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    Object.keys(payload).sort(),
    [...COLD_READER_INPUT_KEYS, "inputHash"].sort(),
  );
  assert.deepEqual(privateContextLeaks(payload), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a report is bound to the exact text that was read", () => {
  const input = prepareColdReaderInput({ resumeText: "Delivered a console to Private Preview.", postingText: "" });
  const report = ZColdReaderReport.parse({
    schemaVersion: "1.0",
    audience: "recruiter",
    inputHash: hashColdReaderInput(input),
    observations: [],
    notes: [],
  });
  assert.equal(reportMatchesInput(report, input), true);

  const other = prepareColdReaderInput({ resumeText: "Delivered a console to customers.", postingText: "" });
  assert.equal(reportMatchesInput(report, other), false);
});

/* ------------------------------------------ deterministic reader risks */

test("a launch stage with no audience is reported without inventing one", () => {
  const resume = withBullets(approvedBaseline(), "example-current", [
    "Delivered a configuration console to Private Preview as ship owner.",
    "Led migration of a legacy dashboard to a typed component architecture.",
    "Built the release validation checks that gate every deploy.",
  ], [["claim-dashboard-migration"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const risks = deterministicReaderRisks({ resume, postingText: "Platform engineering role." });
  const codes = risks.map((risk) => risk.code);

  assert.ok(codes.includes("rollout_label_without_scope"));
  assert.ok(codes.includes("internal_role_label"));

  // Crucially, neither finding supplies the missing fact. The repair belongs to
  // the evidence-aware stage; a reader who has never seen the evidence
  // inventing "external customers" is the fabrication this all exists to stop.
  for (const risk of risks) {
    assert.ok(!/customers used it|reached production|thousands/i.test(risk.message));
  }
});

test("a scope word with its denominator is left alone", () => {
  const vague = withBullets(approvedBaseline(), "example-current", [
    "Delivered full allocation to the eligible cohort.",
    "Led migration of a legacy dashboard to a typed component architecture.",
    "Built the release validation checks that gate every deploy.",
  ], [["claim-dashboard-migration"], ["claim-dashboard-migration"], ["claim-release-checks"]]);
  const flagged = deterministicReaderRisks({ resume: vague, postingText: "" })
    .filter((risk) => risk.code === "unresolved_scale_or_denominator");
  assert.equal(flagged.length, 1, JSON.stringify(flagged, null, 2));
  assert.equal(flagged[0].location, "experience[0].bullets[0]");

  const scoped = withBullets(approvedBaseline(), "example-current", [
    "Delivered full allocation to all 240 eligible accounts in the pilot cohort.",
    "Led migration of a legacy dashboard to a typed component architecture.",
    "Built the release validation checks that gate every deploy.",
  ], [["claim-dashboard-migration"], ["claim-dashboard-migration"], ["claim-release-checks"]]);
  assert.deepEqual(
    deterministicReaderRisks({ resume: scoped, postingText: "" })
      .filter((risk) => risk.code === "unresolved_scale_or_denominator"),
    [],
  );

  // "every deploy" names its population in the next word. A check that fired on
  // ordinary well-written bullets would be ignored within a week.
  assert.deepEqual(
    deterministicReaderRisks({ resume: approvedBaseline(), postingText: "" })
      .filter((risk) => risk.code === "unresolved_scale_or_denominator"),
    [],
  );
});

test("standard vocabulary the audience shares is not flagged", () => {
  const ordinary = withBullets(approvedBaseline(), "example-current", [
    "Built the REST API and CI pipeline for the catalog service.",
    "Led migration of a legacy dashboard to a typed component architecture.",
    "Built the release validation checks that gate every deploy.",
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const risks = deterministicReaderRisks({ resume: ordinary, postingText: "Platform role." });
  assert.deepEqual(risks.filter((risk) => /REST|CI\b/.test(risk.phrase || "")), []);
});

/* --------------------------------------------------- routing findings back */

test("cold-reader observations become uncertain findings with repair routes", () => {
  const findings = coldReaderFindings({
    schemaVersion: "1.0",
    audience: "recruiter",
    inputHash: "a".repeat(64),
    observations: [
      {
        phrase: "Private Preview",
        section: "experience",
        likelyInterpretation: "an internal test that never reached anyone outside the company",
        competingInterpretation: "a controlled trial with real external customers",
        readerQuestion: "who could actually use it?",
        contributesMeaning: false,
        code: "rollout_label_without_scope",
        severity: "warning",
      },
      {
        phrase: "TypeScript",
        section: "skills",
        likelyInterpretation: "the language the candidate writes in",
        competingInterpretation: "",
        readerQuestion: "",
        contributesMeaning: true,
        code: "understood",
        severity: "info",
      },
    ],
    notes: [],
  });

  assert.equal(findings.length, 1, "an understood phrase is not a finding");
  const [finding] = findings;

  // Never `unsupported`. The cold reader has not seen the evidence and is in no
  // position to say anything about support; filing an interpretation problem as
  // a fabrication would be the dishonest half of this feature.
  assert.equal(finding.status, "uncertain");
  assert.equal(finding.source, "cold_reader");
  assert.equal(finding.location, "Private Preview");
  assert.match(finding.finding, /would take "Private Preview" to mean/);
  assert.match(finding.finding, /It could equally mean/);
  assert.match(finding.finding, /Removing it would cost the reader nothing/);
  assert.ok(finding.suggestedActions.includes("Remove the statement"));
  assert.ok(finding.suggestedActions.some((action) => /Translate the term/.test(action)));
});

test("the cold-reader agent is denied every private input", () => {
  const agent = fs.readFileSync(
    path.join(ROOT, "agents", "resume-builders", "resume-cold-reader.agent.md"),
    "utf8",
  );
  const prose = agent.replace(/[*`_]/g, "");
  assert.match(prose, /claims\.json/);
  assert.match(prose, /accomplishments\.json/);
  assert.match(prose, /application-strategy\.json/);
  assert.match(prose, /editorial-plan\.json/);
  assert.match(prose, /do not (?:read|open)/i);
  assert.match(prose, /never invent/i);
  // It reports interpretation; it does not author the repair.
  assert.match(prose, /not[^.]{0,40}(?:write|author|invent)[^.]{0,40}repair/i);
});
