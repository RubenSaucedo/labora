#!/usr/bin/env node
// career-issue.js — drafts a well-formed issue for a repository the persona
// owns, from a route labora already derived.
//
// It never runs `gh`. Bulk-filing issues onto someone's repository is a worse
// outcome than the gap, so the tool produces a body file and the exact command,
// and a human decides whether each one is filed.
//
// Usage:
//   labora career-issue draft <persona> --kind <polish|legibility|gap|growth> \
//     --repo <owner/repo> --title <text> --problem <text> --route <text> \
//     --done-when <text> [--why <text>] [--claim <id>]... [--requirement <id>] \
//     [--gap-status <status>] [--allow-term <term>]... [--output <file>]
//   labora career-issue check <persona> <body-file>
import fs from "node:fs";
import path from "node:path";

import { resolvePersonaRoot } from "../lib/workspace.js";
import {
  CAREER_ISSUE_KINDS,
  collectForbiddenTerms,
  disclosureFindings,
  fileCommand,
  normalizeDraft,
  renderCareerIssue,
  slugifyTitle,
} from "../lib/career-issue.js";

const USAGE =
  `Usage: labora career-issue draft <persona> --kind <${CAREER_ISSUE_KINDS.join("|")}> ` +
  "--repo <owner/repo> --title <text> --problem <text> --route <text> --done-when <text> " +
  "[--why <text>] [--claim <id>]... [--requirement <id>] [--gap-status <status>] " +
  "[--allow-term <term>]... [--output <file>]\n" +
  "       labora career-issue check <persona> <body-file>\n";

const argv = process.argv.slice(2);

function flag(name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function flagAll(name) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) values.push(argv[i + 1]);
  }
  return values;
}

function reportFindings(findings, where) {
  process.stderr.write(
    `career-issue: ${findings.length} term(s) in ${where} identify the job search or the person.\n`
  );
  for (const finding of findings) {
    process.stderr.write(`  - ${finding.term}\n`);
  }
  process.stderr.write(
    "\nA repository issue is a legitimate engineering request or it is nothing.\n" +
    "Two routes: rewrite the text so the issue stands on the repository's own\n" +
    "terms, or re-run with --allow-term <term> if the mention is about a\n" +
    "technology rather than about employment. Publication is permanent, so the\n" +
    "decision is made before filing, not after.\n"
  );
}

const command = argv[0];
const personaArg = argv[1];

if (!["draft", "check"].includes(command) || !personaArg) {
  process.stderr.write(USAGE);
  process.exit(1);
}

try {
  const personaRoot = fs.existsSync(personaArg) ? personaArg : resolvePersonaRoot(personaArg);
  const forbidden = collectForbiddenTerms(personaRoot);
  const acknowledged = flagAll("--allow-term");

  if (command === "check") {
    const bodyPath = argv[2];
    if (!bodyPath) {
      process.stderr.write(USAGE);
      process.exit(1);
    }
    const body = fs.readFileSync(bodyPath, "utf8");
    const findings = disclosureFindings(body, forbidden, acknowledged);
    if (findings.length) {
      reportFindings(findings, path.basename(bodyPath));
      process.exit(1);
    }
    process.stdout.write(`career-issue: ${path.basename(bodyPath)} is clear to publish.\n`);
    process.exit(0);
  }

  const draftedAt = new Date().toISOString();
  const draft = normalizeDraft({
    kind: flag("--kind"),
    repo: flag("--repo"),
    title: flag("--title"),
    problem: flag("--problem"),
    route: flag("--route"),
    doneWhen: flag("--done-when"),
    whyItMatters: flag("--why"),
    provenance: {
      claimIds: flagAll("--claim"),
      requirementId: flag("--requirement"),
      gapStatus: flag("--gap-status"),
    },
    draftedAt,
    acknowledgedTerms: acknowledged,
  });

  const body = renderCareerIssue(draft);

  const outDir = path.join(personaRoot, "career-issues");
  fs.mkdirSync(outDir, { recursive: true });
  const stem = `${draftedAt.slice(0, 10)}-${draft.kind}-${slugifyTitle(draft.title)}`;
  const bodyPath = flag("--output", path.join(outDir, `${stem}.md`));
  fs.writeFileSync(bodyPath, body);
  fs.writeFileSync(
    path.join(outDir, `${stem}.json`),
    JSON.stringify({ ...draft, bodyPath }, null, 2) + "\n"
  );

  // The workspace is private and is allowed to hold the real wording; what is
  // gated is publication. So the draft is always written, and only the command
  // that would publish it is withheld.
  const findings = disclosureFindings(`${draft.title}\n${body}`, forbidden, acknowledged);
  if (findings.length) {
    process.stderr.write(`career-issue: draft written to ${bodyPath}, not cleared to publish.\n`);
    reportFindings(findings, "the draft");
    process.exit(1);
  }

  process.stdout.write(body);
  process.stdout.write(
    `\nDraft written to ${bodyPath}\n\n` +
    "Review it, then file it yourself:\n\n  " +
    fileCommand(draft, bodyPath) + "\n"
  );
} catch (err) {
  process.stderr.write(`career-issue error: ${err.message}\n`);
  process.exit(1);
}
