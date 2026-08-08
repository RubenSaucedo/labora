#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  emptyApplicationOutcome,
  recordOutcomeEvent,
} from "../lib/application-outcome.js";
import {
  OUTCOME_EVENTS,
  ZApplicationOutcome,
  ZApplicationOutcomeEvent,
} from "../schemas/application-outcome.js";

function flag(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const applicationDir = process.argv[2];
const command = process.argv[3];
const eventType = process.argv[4];

if (!applicationDir || !["show", "record"].includes(command)) {
  process.stderr.write(
    `Usage: labora application-outcome <application-dir> show|record [${OUTCOME_EVENTS.join("|")}] [--at ISO] [--channel text] [--note text]\n`
  );
  process.exit(1);
}

try {
  const resolved = path.resolve(applicationDir);
  const outputPath = path.join(resolved, "outcome.json");
  const application = path.basename(resolved);
  const existing = fs.existsSync(outputPath)
    ? ZApplicationOutcome.parse(JSON.parse(fs.readFileSync(outputPath, "utf8")))
    : emptyApplicationOutcome(application);

  if (command === "show") {
    process.stdout.write(JSON.stringify(existing, null, 2) + "\n");
    process.exit(0);
  }

  const event = ZApplicationOutcomeEvent.parse({
    type: eventType,
    at: flag("--at", new Date().toISOString()),
    channel: flag("--channel"),
    note: flag("--note"),
    source: "operator",
  });
  const next = recordOutcomeEvent(existing, event);
  fs.writeFileSync(outputPath, JSON.stringify(next, null, 2) + "\n");
  process.stdout.write(JSON.stringify(next, null, 2) + "\n");
} catch (error) {
  process.stderr.write(`application-outcome error: ${error.message}\n`);
  process.exit(1);
}
