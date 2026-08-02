import { ZApplicationOutcome } from "../schemas/application-outcome.js";

export function emptyApplicationOutcome(application, at = new Date().toISOString()) {
  return {
    schemaVersion: "1.0",
    application,
    currentStatus: "not_submitted",
    updatedAt: at,
    events: [],
  };
}

export function recordOutcomeEvent(outcome, event) {
  const parsed = ZApplicationOutcome.parse(outcome);
  const nextEvents = [...parsed.events, event].sort((a, b) => a.at.localeCompare(b.at));
  const duplicate = parsed.events.some((existing) =>
    existing.type === event.type &&
    existing.at === event.at &&
    existing.channel === (event.channel || "")
  );
  if (duplicate) throw new Error("The same outcome event is already recorded.");

  return ZApplicationOutcome.parse({
    ...parsed,
    currentStatus: nextEvents[nextEvents.length - 1]?.type || "not_submitted",
    updatedAt: nextEvents[nextEvents.length - 1]?.at || parsed.updatedAt,
    events: nextEvents,
  });
}
