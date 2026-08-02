import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyApplicationOutcome,
  recordOutcomeEvent,
} from "../src/lib/application-outcome.js";

test("records objective funnel events in chronological order", () => {
  let outcome = emptyApplicationOutcome("example", "2026-07-01T00:00:00.000Z");
  outcome = recordOutcomeEvent(outcome, {
    type: "recruiter_screen",
    at: "2026-07-03T00:00:00.000Z",
    channel: "phone",
    note: "",
    source: "operator",
  });
  outcome = recordOutcomeEvent(outcome, {
    type: "submitted",
    at: "2026-07-02T00:00:00.000Z",
    channel: "portal",
    note: "",
    source: "operator",
  });

  assert.deepEqual(outcome.events.map((event) => event.type), [
    "submitted",
    "recruiter_screen",
  ]);
  assert.equal(outcome.currentStatus, "recruiter_screen");
});

test("rejects duplicate outcome events", () => {
  const event = {
    type: "submitted",
    at: "2026-07-02T00:00:00.000Z",
    channel: "portal",
    note: "",
    source: "operator",
  };
  const outcome = recordOutcomeEvent(emptyApplicationOutcome("example"), event);
  assert.throws(() => recordOutcomeEvent(outcome, event), /already recorded/);
});
