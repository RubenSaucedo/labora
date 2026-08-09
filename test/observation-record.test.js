import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ZObservation } from "../src/schemas/observation-record.js";
import { validateObservations } from "../src/lib/validate-observations.js";

function record(overrides = {}) {
  return {
    schemaVersion: "1.0",
    persona: "example",
    target: "https://example.com",
    exploredAt: "2026-01-01",
    method: "scripted browser session",
    observations: [{
      id: "obs-1",
      observed: "Creating a plan and reloading the page returns the same plan.",
      verifiedHow: "Created 3 plans, hard-reloaded, all 3 present after 24h.",
      supports: ["server-side persistence"],
      doesNotEstablish: ["Concurrency safety under multi-user write."],
      tier: "publicly_reproducible",
      observedAt: "2026-01-01",
    }],
    ...overrides,
  };
}

test("a well-formed observation is derivable", () => {
  const result = validateObservations(record());
  assert.equal(result.valid, true);
  assert.equal(result.derivable, 1);
});

// An observation record grounds claims, so it must carry no evaluation. This is
// the split the whole contract rests on.
test("an impression is not a verification", () => {
  const result = validateObservations(record({
    observations: [{
      ...record().observations[0],
      verifiedHow: "Clicked around; the app felt fast and the UX was really clean.",
    }],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === "verification_is_impression"));
});

test("a verification without a measurement is flagged", () => {
  const result = validateObservations(record({
    observations: [{
      ...record().observations[0],
      verifiedHow: "Reloaded the page and the data was still there.",
    }],
  }));
  assert.ok(result.warnings.some((e) => e.code === "verification_without_measurement"));
  assert.equal(result.derivable, 0);
});

// Without a real boundary a client-side behaviour silently becomes "durable
// execution", and an in-memory one becomes "persisted".
test("a vacuous boundary is rejected", () => {
  for (const boundary of ["N/A", "none", "-", "TBD"]) {
    const result = validateObservations(record({
      observations: [{ ...record().observations[0], doesNotEstablish: [boundary] }],
    }));
    assert.equal(result.valid, false, `expected ${boundary} to be rejected`);
    assert.ok(result.errors.some((e) => e.code === "boundary_is_vacuous"));
  }
});

test("an observation with no boundary at all fails the schema", () => {
  const result = validateObservations(record({
    observations: [{ ...record().observations[0], doesNotEstablish: [] }],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === "schema_invalid"));
});

// Defects are feedback on real software, never a verdict on the evidence.
test("a defect can never be marked blocking", () => {
  const result = validateObservations(record({
    defectAppendix: [{ id: "d-1", summary: "Toast overlaps footer", blocking: true }],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === "defect_marked_blocking"));
});

test("defects do not invalidate the positive findings", () => {
  const result = validateObservations(record({
    defectAppendix: [
      { id: "d-1", summary: "Toast overlaps footer", severity: "low", blocking: false },
      { id: "d-2", summary: "Slow first paint on cold cache", severity: "medium", blocking: false },
    ],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.derivable, 1);
  assert.equal(result.defectCount, 2);
});

// A live run once contradicted a claim already marked `verified` in the ledger.
// The format must have somewhere prominent to put that.
test("a contradiction is carried and counted", () => {
  const result = validateObservations(record({
    contradictions: [{
      id: "con-1",
      claimId: "C-12",
      assertion: "Plans persist across devices.",
      observed: "Plans created on device A were absent on device B after login.",
      verifiedHow: "2 devices, same account, 3 attempts each.",
      observedAt: "2026-01-01",
      severity: "claim_is_false",
    }],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.contradictionCount, 1);
});

test("an unlinked contradiction is flagged as unactionable", () => {
  const result = validateObservations(record({
    contradictions: [{
      id: "con-1",
      assertion: "Plans persist across devices.",
      observed: "Plans were absent on the second device.",
      verifiedHow: "2 devices, 3 attempts each.",
      observedAt: "2026-01-01",
      severity: "claim_is_false",
    }],
  }));
  assert.ok(result.warnings.some((e) => e.code === "contradiction_unlinked"));
});

test("an exploration that found only defects has produced no evidence", () => {
  const result = validateObservations(record({
    observations: [],
    defectAppendix: [{ id: "d-1", summary: "Broken link", blocking: false }],
  }));
  assert.ok(result.warnings.some((e) => e.code === "no_positive_findings"));
});

// The drift this suite failed to catch once: the skill documented three tiers
// and the schema accepted a different three, so anyone following the written
// contract got a rejection. A doc and a schema that disagree is a contract that
// does not exist, and only a test that reads both can notice.
test("every tier the skill documents is accepted by the schema", () => {
  const skill = fs.readFileSync(
    new URL("../skills/evidence-exploration/SKILL.md", import.meta.url),
    "utf8"
  );
  const documented = [...skill.matchAll(/^\| `([a-z_]+)` \| /gm)].map((m) => m[1]);
  assert.ok(documented.length >= 3, "expected the skill to document a tier table");

  for (const tier of documented) {
    const result = validateObservations(record({
      observations: [{ ...record().observations[0], tier }],
    }));
    assert.ok(
      !result.errors.some((e) => e.code === "schema_invalid"),
      `the skill documents tier "${tier}" but the schema rejects it`
    );
  }
});

test("the schema accepts no tier the skill leaves undocumented", () => {
  const skill = fs.readFileSync(
    new URL("../skills/evidence-exploration/SKILL.md", import.meta.url),
    "utf8"
  );
  const documented = new Set(
    [...skill.matchAll(/^\| `([a-z_]+)` \| /gm)].map((m) => m[1])
  );
  for (const tier of ZObservation.shape.tier.unwrap().options) {
    assert.ok(
      documented.has(tier),
      `the schema accepts tier "${tier}" that the skill never documents`
    );
  }
});

// A thing the persona merely stated was never observed. Accepting it here would
// let the record launder an assertion into a verification.
test("self-reported is not an observation tier", () => {
  const result = validateObservations(record({
    observations: [{ ...record().observations[0], tier: "self_reported" }],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === "schema_invalid"));
});
