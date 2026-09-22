import test from "node:test";
import assert from "node:assert/strict";

import { baselineEditorialView, sha256 } from "../src/lib/editorial-baseline.js";
import { validateEditorialPlan } from "../src/lib/editorial-plan.js";
import { ZTailoredResume } from "../src/schemas/tailored-resume.js";
import { ZEditorialPlan } from "../src/schemas/editorial.js";

import {
  accomplishmentBank,
  approvedBaseline,
  claimLedger,
  emptyPlan,
  withBullets,
  withSummarySentences,
} from "./fixtures/editorial.js";

/**
 * The seven operations, and what each one is allowed to do to evidence.
 *
 * Every case here is a change that is *truthful sentence by sentence* and wrong
 * as an edit. That is the whole class of defect the editorial plan exists to
 * catch: claim validation reads one span at a time and cannot see that the
 * latency figure ended up beside the wrong subject, or that two supported
 * bullets became one sentence asserting a causal chain neither source states.
 */

function harness(baseline) {
  const view = baselineEditorialView(baseline);
  const hash = sha256(Buffer.from(JSON.stringify(baseline), "utf8"));
  const keep = (locations) =>
    view.segments
      .filter((segment) => locations.includes(segment.location))
      .map((segment) => ({
        location: segment.location,
        operation: "keep",
        originalText: segment.text,
        semanticDelta: "none",
        requiresReapproval: false,
      }));
  const all = view.segments.map((segment) => segment.location);
  const keepExcept = (excluded) => keep(all.filter((location) => !excluded.includes(location)));

  const run = (operations, revised, extra = {}) =>
    validateEditorialPlan({
      plan: ZEditorialPlan.parse({ ...emptyPlan, baselineHash: hash, operations, ...extra }),
      baselineView: view,
      revised,
      claimLedger,
      bank: accomplishmentBank,
      baselineApproved: true,
      baselineHash: hash,
    });

  return { view, hash, keep, keepExcept, run };
}

/* ------------------------------------------------------- required item 6 */

test("a move carries its claim mapping to the destination", () => {
  const baseline = approvedBaseline();
  const { keepExcept, run } = harness(baseline);

  const movedText = baseline.provenance.summary[1].text;
  const relocated = withBullets(
    withSummarySentences(baseline, [baseline.provenance.summary[0].text], [{ claimIds: ["claim-tenure"], unitIds: [] }]),
    "example-current",
    [...baseline.experience[0].bullets, movedText],
    [
      ["claim-catalog-pipeline"],
      ["claim-dashboard-migration"],
      ["claim-release-checks"],
      ["claim-dashboard-migration", "claim-release-checks"],
    ],
  );

  const move = {
    location: "summary.sentences[1]",
    operation: "move",
    originalText: movedText,
    destination: "experience[0].bullets[3]",
    reason: "Lifecycle detail belongs with the evidence-bearing accomplishment, not in the career interpretation.",
    semanticDelta: "moved",
    claimIds: ["claim-dashboard-migration", "claim-release-checks"],
    unitIds: ["unit-dashboard", "unit-release"],
    affects: [],
    requiresReapproval: true,
  };

  const ok = run([...keepExcept(["summary.sentences[1]"]), move], relocated);
  assert.equal(ok.valid, true, JSON.stringify(ok.issues, null, 2));
  assert.deepEqual(ok.coverage.unexplainedLocations, []);
  assert.ok(ok.reapproval.required);
  assert.deepEqual(ok.reapproval.locations, ["summary.sentences[1]"]);

  // Meaning is preserved because the text is preserved: a move that also
  // reworded is two operations, and saying so is the point.
  const landed = relocated.experience[0].bullets[3];
  assert.equal(landed, movedText);
});

test("a move that drops its claim mapping is rejected", () => {
  const baseline = approvedBaseline();
  const { keepExcept, run } = harness(baseline);
  const movedText = baseline.provenance.summary[1].text;

  const relocated = withBullets(
    withSummarySentences(baseline, [baseline.provenance.summary[0].text], [{ claimIds: ["claim-tenure"], unitIds: [] }]),
    "example-current",
    [...baseline.experience[0].bullets, movedText],
    [
      ["claim-catalog-pipeline"],
      ["claim-dashboard-migration"],
      ["claim-release-checks"],
      // The release-checks claim did not travel with the sentence that asserts it.
      ["claim-dashboard-migration"],
    ],
  );

  const result = run([...keepExcept(["summary.sentences[1]"]), {
    location: "summary.sentences[1]",
    operation: "move",
    originalText: movedText,
    destination: "experience[0].bullets[3]",
    reason: "placement",
    semanticDelta: "moved",
    claimIds: ["claim-dashboard-migration", "claim-release-checks"],
    unitIds: [],
    requiresReapproval: true,
  }], relocated);

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "move_drops_claim_mapping"), JSON.stringify(result.issues));
});

/* ------------------------------------------------------- required item 7 */

const COMBINED_BULLET =
  "Designed and built a multi-source catalog pipeline that kept producing usable results when individual " +
  "sources failed, and cut P95 end-to-end completion latency 74% across the shared request path.";

function baselineWithCombinedBullet() {
  const baseline = approvedBaseline();
  return withBullets(
    baseline,
    "example-current",
    [COMBINED_BULLET, ...baseline.experience[0].bullets.slice(1)],
    [
      ["claim-catalog-pipeline", "claim-catalog-latency"],
      ["claim-dashboard-migration"],
      ["claim-release-checks"],
    ],
  );
}

test("a split keeps each outcome with the subject that was measured", () => {
  const baseline = baselineWithCombinedBullet();
  const { keepExcept, run } = harness(baseline);

  const split = withBullets(baseline, "example-current", [
    "Designed and built a multi-source catalog pipeline that kept producing usable results when individual sources failed.",
    "Cut P95 end-to-end completion latency 74% across the shared catalog request path.",
    ...baseline.experience[0].bullets.slice(1),
  ], [
    ["claim-catalog-pipeline"],
    ["claim-catalog-latency"],
    ["claim-dashboard-migration"],
    ["claim-release-checks"],
  ]);

  const operations = [
    ...keepExcept([
      "experience[0].bullets[0]",
      "experience[0].bullets[1]",
      "experience[0].bullets[2]",
    ]),
    {
      location: "experience[0].bullets[0]",
      operation: "split",
      originalText: COMBINED_BULLET,
      products: [
        { location: "experience[0].bullets[0]", text: split.experience[0].bullets[0] },
        { location: "experience[0].bullets[1]", text: split.experience[0].bullets[1] },
      ],
      reason: "Partial-failure behaviour and the latency result are separate accomplishments measured differently.",
      semanticDelta: "split",
      claimIds: ["claim-catalog-pipeline", "claim-catalog-latency"],
      unitIds: ["unit-catalog"],
      requiresReapproval: true,
    },
    // The two bullets below shifted down one index, so their approved wording
    // now lives at a new address. That is a move, and it has to be declared.
    moveBullet("experience[0].bullets[1]", "experience[0].bullets[2]", baseline.experience[0].bullets[1], ["claim-dashboard-migration"]),
    moveBullet("experience[0].bullets[2]", "experience[0].bullets[3]", baseline.experience[0].bullets[2], ["claim-release-checks"]),
  ];

  const result = run(operations, split);
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("a split that attaches the outcome to the wrong subject is rejected", () => {
  const baseline = baselineWithCombinedBullet();
  const { keepExcept, run } = harness(baseline);

  // The 74% followed the *pipeline* half, whose claim never measured it. The
  // claims are partitioned correctly; only the number went to the wrong side,
  // which is the case a claim-set check alone would pass.
  const split = withBullets(baseline, "example-current", [
    "Designed and built a multi-source catalog pipeline, cutting latency 74%.",
    "Kept producing usable results across the shared catalog request path when sources failed.",
    ...baseline.experience[0].bullets.slice(1),
  ], [
    ["claim-catalog-pipeline"],
    ["claim-catalog-latency"],
    ["claim-dashboard-migration"],
    ["claim-release-checks"],
  ]);

  const result = run([
    ...keepExcept(["experience[0].bullets[0]", "experience[0].bullets[1]", "experience[0].bullets[2]"]),
    {
      location: "experience[0].bullets[0]",
      operation: "split",
      originalText: COMBINED_BULLET,
      products: [
        { location: "experience[0].bullets[0]", text: split.experience[0].bullets[0] },
        { location: "experience[0].bullets[1]", text: split.experience[0].bullets[1] },
      ],
      reason: "separate the mechanism from the outcome",
      semanticDelta: "split",
      claimIds: ["claim-catalog-pipeline", "claim-catalog-latency"],
      unitIds: ["unit-catalog"],
      requiresReapproval: true,
    },
    moveBullet("experience[0].bullets[1]", "experience[0].bullets[2]", baseline.experience[0].bullets[1], ["claim-dashboard-migration"]),
    moveBullet("experience[0].bullets[2]", "experience[0].bullets[3]", baseline.experience[0].bullets[2], ["claim-release-checks"]),
  ], split);

  assert.equal(result.valid, false);
  const mismatch = result.issues.find((issue) => issue.code === "split_outcome_subject_mismatch");
  assert.ok(mismatch, JSON.stringify(result.issues, null, 2));
  assert.equal(mismatch.location, "experience[0].bullets[0]");
  assert.match(mismatch.message, /prints "74%", which none of its mapped claims contains/);
});

test("a split may not hand one measured outcome to two subjects", () => {
  const baseline = baselineWithCombinedBullet();
  const { keepExcept, run } = harness(baseline);

  // No numbers anywhere, so only the partition rule can catch this: one claim
  // is asserted about two different subjects.
  const split = withBullets(baseline, "example-current", [
    "Designed and built a multi-source catalog pipeline.",
    "Kept producing usable results when individual sources failed.",
    ...baseline.experience[0].bullets.slice(1),
  ], [
    ["claim-catalog-pipeline"],
    ["claim-catalog-pipeline"],
    ["claim-dashboard-migration"],
    ["claim-release-checks"],
  ]);

  const result = run([
    ...keepExcept(["experience[0].bullets[0]", "experience[0].bullets[1]", "experience[0].bullets[2]"]),
    {
      location: "experience[0].bullets[0]",
      operation: "split",
      originalText: COMBINED_BULLET,
      products: [
        { location: "experience[0].bullets[0]", text: split.experience[0].bullets[0] },
        { location: "experience[0].bullets[1]", text: split.experience[0].bullets[1] },
      ],
      reason: "separate the object from the failure behaviour",
      semanticDelta: "split",
      claimIds: ["claim-catalog-pipeline", "claim-catalog-latency"],
      unitIds: ["unit-catalog"],
      requiresReapproval: true,
    },
    moveBullet("experience[0].bullets[1]", "experience[0].bullets[2]", baseline.experience[0].bullets[1], ["claim-dashboard-migration"]),
    moveBullet("experience[0].bullets[2]", "experience[0].bullets[3]", baseline.experience[0].bullets[2], ["claim-release-checks"]),
  ], split);

  assert.equal(result.valid, false);
  const duplicated = result.issues.find((issue) =>
    issue.code === "split_outcome_subject_mismatch" && /attached to both/.test(issue.message));
  assert.ok(duplicated, JSON.stringify(result.issues, null, 2));
});

test("a split may not acquire evidence its source never carried", () => {
  const baseline = baselineWithCombinedBullet();
  const { keepExcept, run } = harness(baseline);

  const split = withBullets(baseline, "example-current", [
    "Designed and built a multi-source catalog pipeline that kept producing usable results when individual sources failed.",
    "Led migration of a legacy dashboard to a typed component architecture.",
    ...baseline.experience[0].bullets.slice(1),
  ], [
    ["claim-catalog-pipeline"],
    ["claim-dashboard-migration"],
    ["claim-dashboard-migration"],
    ["claim-release-checks"],
  ]);

  const result = run([
    ...keepExcept(["experience[0].bullets[0]", "experience[0].bullets[1]", "experience[0].bullets[2]"]),
    {
      location: "experience[0].bullets[0]",
      operation: "split",
      originalText: COMBINED_BULLET,
      products: [
        { location: "experience[0].bullets[0]", text: split.experience[0].bullets[0] },
        { location: "experience[0].bullets[1]", text: split.experience[0].bullets[1] },
      ],
      reason: "split",
      semanticDelta: "split",
      claimIds: ["claim-catalog-pipeline", "claim-catalog-latency"],
      unitIds: ["unit-catalog"],
      requiresReapproval: true,
    },
    moveBullet("experience[0].bullets[1]", "experience[0].bullets[2]", baseline.experience[0].bullets[1], ["claim-dashboard-migration"]),
    moveBullet("experience[0].bullets[2]", "experience[0].bullets[3]", baseline.experience[0].bullets[2], ["claim-release-checks"]),
  ], split);

  assert.ok(result.issues.some((issue) => issue.code === "split_introduces_claim"), JSON.stringify(result.issues, null, 2));
});

/* ------------------------------------------------------- required item 8 */

test("a combine is accepted inside one accomplishment and one attribution level", () => {
  const baseline = approvedBaseline();
  const { keepExcept, run } = harness(baseline);

  const combined = withBullets(baseline, "example-current", [
    COMBINED_BULLET,
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [
    ["claim-catalog-pipeline", "claim-catalog-latency"],
    ["claim-dashboard-migration"],
    ["claim-release-checks"],
  ]);

  const result = run([
    ...keepExcept(["experience[0].bullets[0]"]),
    {
      location: "experience[0].bullets[0]",
      operation: "combine",
      originalText: baseline.experience[0].bullets[0],
      additionalSources: [],
      destination: "experience[0].bullets[0]",
      reason: "The failure behaviour and the latency result are one causal accomplishment in one unit.",
      semanticDelta: "combined",
      claimIds: ["claim-catalog-pipeline", "claim-catalog-latency"],
      unitIds: ["unit-catalog"],
      requiresReapproval: true,
    },
  ], combined);

  // `combine_without_sources` is expected here because only one baseline span
  // was consumed; the evidence-boundary checks are what this asserts.
  const boundaryCodes = result.issues
    .map((issue) => issue.code)
    .filter((code) => code.startsWith("combine_crosses"));
  assert.deepEqual(boundaryCodes, []);
});

test("a combine crossing accomplishment and attribution boundaries is rejected", () => {
  const baseline = approvedBaseline();
  const { keepExcept, run } = harness(baseline);

  const merged =
    "Designed and built a multi-source catalog pipeline and led migration of a legacy dashboard to a typed " +
    "component architecture.";
  const revised = withBullets(baseline, "example-current", [
    merged,
    baseline.experience[0].bullets[2],
  ], [
    ["claim-catalog-pipeline", "claim-dashboard-migration"],
    ["claim-release-checks"],
  ]);

  const result = run([
    ...keepExcept([
      "experience[0].bullets[0]",
      "experience[0].bullets[1]",
      "experience[0].bullets[2]",
    ]),
    {
      location: "experience[0].bullets[0]",
      operation: "combine",
      originalText: baseline.experience[0].bullets[0],
      additionalSources: [
        { location: "experience[0].bullets[1]", text: baseline.experience[0].bullets[1] },
      ],
      destination: "experience[0].bullets[0]",
      reason: "shorten the role",
      semanticDelta: "combined",
      claimIds: ["claim-catalog-pipeline", "claim-dashboard-migration"],
      unitIds: ["unit-catalog", "unit-dashboard"],
      requiresReapproval: true,
    },
    moveBullet("experience[0].bullets[2]", "experience[0].bullets[1]", baseline.experience[0].bullets[2], ["claim-release-checks"]),
  ], revised);

  assert.equal(result.valid, false);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes("combine_crosses_accomplishment_boundary"), JSON.stringify(codes));
  assert.ok(codes.includes("combine_crosses_attribution_boundary"), JSON.stringify(codes));
});

/* ------------------------------------------------------------ reapproval */

test("reapproval is required exactly when placement or meaning changed", () => {
  const baseline = approvedBaseline();
  const { keepExcept, run } = harness(baseline);

  const revised = withBullets(baseline, "example-current", [
    "Designed and built a multi-source catalog pipeline that gathered provider data concurrently and kept producing usable results when individual sources failed.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const honest = run([...keepExcept(["experience[0].bullets[0]"]), {
    location: "experience[0].bullets[0]",
    operation: "rewrite",
    originalText: baseline.experience[0].bullets[0],
    proposedText: revised.experience[0].bullets[0],
    reason: "Restore the retrieval mechanism the reader needs to understand the failure behaviour.",
    semanticDelta: "none",
    claimIds: ["claim-catalog-pipeline"],
    unitIds: ["unit-catalog"],
    requiresReapproval: false,
  }], revised);
  assert.equal(honest.valid, true, JSON.stringify(honest.issues, null, 2));
  assert.equal(honest.reapproval.required, false);

  const dishonest = run([...keepExcept(["experience[0].bullets[0]"]), {
    location: "experience[0].bullets[0]",
    operation: "rewrite",
    originalText: baseline.experience[0].bullets[0],
    proposedText: revised.experience[0].bullets[0],
    reason: "narrow it",
    semanticDelta: "narrowed",
    claimIds: ["claim-catalog-pipeline"],
    unitIds: ["unit-catalog"],
    requiresReapproval: false,
  }], revised);
  assert.ok(dishonest.issues.some((issue) => issue.code === "change_requires_reapproval"));
});

test("an unreviewed baseline requires no reapproval, because nothing was approved", () => {
  const baseline = approvedBaseline();
  const view = baselineEditorialView(baseline);
  const hash = sha256(Buffer.from(JSON.stringify(baseline), "utf8"));
  const revised = withBullets(baseline, "example-current", [
    "Built a catalog pipeline with partial-result continuation.",
    baseline.experience[0].bullets[1],
    baseline.experience[0].bullets[2],
  ], [["claim-catalog-pipeline"], ["claim-dashboard-migration"], ["claim-release-checks"]]);

  const result = validateEditorialPlan({
    plan: ZEditorialPlan.parse({
      ...emptyPlan,
      baselineHash: hash,
      operations: [
        ...view.segments
          .filter((segment) => segment.location !== "experience[0].bullets[0]")
          .map((segment) => ({
            location: segment.location,
            operation: "keep",
            originalText: segment.text,
            requiresReapproval: false,
          })),
        {
          location: "experience[0].bullets[0]",
          operation: "rewrite",
          originalText: baseline.experience[0].bullets[0],
          proposedText: revised.experience[0].bullets[0],
          reason: "tighten",
          semanticDelta: "narrowed",
          claimIds: ["claim-catalog-pipeline"],
          requiresReapproval: false,
        },
      ],
    }),
    baselineView: view,
    revised,
    claimLedger,
    bank: accomplishmentBank,
    baselineApproved: false,
    baselineHash: hash,
  });

  assert.equal(result.reapproval.required, false);
  assert.ok(!result.issues.some((issue) => issue.code === "change_requires_reapproval"));
});

function moveBullet(from, to, text, claimIds) {
  return {
    location: from,
    operation: "move",
    originalText: text,
    destination: to,
    reason: "Index shifted because an earlier bullet was split; wording is unchanged.",
    semanticDelta: "moved",
    claimIds,
    requiresReapproval: true,
  };
}

test("the schema keeps the seven operations closed", () => {
  const parsed = ZEditorialPlan.safeParse({
    ...emptyPlan,
    operations: [{ location: "headline", operation: "improve" }],
  });
  assert.equal(parsed.success, false);
  const resume = ZTailoredResume.parse(approvedBaseline());
  assert.ok(resume.summary.length > 0);
});
