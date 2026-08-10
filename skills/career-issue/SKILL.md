---
name: career-issue
description: "Turns a named route from a gap or profile report into a well-formed issue on a repository the persona owns, in a standard shape with allowlisted provenance. Drafts only — it never files. Invoke for 'open an issue for this gap', 'make this project readable', or 'track this route'. Load resume-conventions first."
tools: [bash, view, glob, grep]
user-invocable: true
argument-hint: "<persona> [--kind polish|legibility|gap|growth]"
---

# /career-issue — turn a route into an issue on the persona's own repo

Load `resume-conventions` first, especially the outbound-disclosure boundary.

Labora's contract is that a gap is reported **with the route that would close
it**. Left in a report, that route has no owner and no date, and the next run
re-derives the same gap from the same silent corpus. This skill gives the route
somewhere to live: an issue on a repository the persona owns.

## What it is not

- **Not evidence.** A filed issue is a promise. Merged, shipped, readable work
  is evidence. No later stage may read open issues as claims, or the pipeline
  becomes gameable by typing.
- **Not automatic.** The tool drafts; a human files. Never run `gh issue create`
  on the operator's behalf, and never draft a batch of issues and file them.
  Twenty issues appearing on someone's repository in one minute is a worse
  outcome than the gap was.
- **Not for repositories the persona does not own.** Filing on someone else's
  project is open-source contribution etiquette, which is a different problem
  and is out of scope.

## The four kinds

Pick the kind by what closing the issue actually buys, not by how big it feels.

| Kind | What it is | What closing it produces |
| --- | --- | --- |
| `polish` | A real defect — stale README command, dead link, broken formatting | A signal of care on a surface a reader opens. Little claim value. |
| `legibility` | Work that exists but cannot be read — no README, no demo, no architecture note | Converts inaccessible evidence into attestable evidence. Highest leverage, lowest invention risk. |
| `gap` | A requirement the corpus does not cover | New verifiable work. Slowest, and must read as not yet true. |
| `growth` | A stretch toward a stated career goal | A deliberate, dated direction. |

`legibility` is usually the right answer and is usually skipped. Per
`PHILOSOPHY.md`, *inaccessible evidence is not absent evidence* — a private
repository or a README that never says what the thing does is work that already
happened and cannot be assessed. The route is not "build something new", it is
"make the existing work readable", and that is issue-sized.

## Drafting

Write each field about the artifact or the repository, never about the person.
"The README does not say what this service does" is a fact about a file.
"Ruben cannot explain his work" is a claim about a human being, and is not
yours to make.

```bash
labora career-issue draft <persona> \
  --kind legibility \
  --repo <owner/repo> \
  --title "<short imperative title>" \
  --problem "<what is wrong or missing, stated about the artifact>" \
  --route "<one bounded next step>" \
  --done-when "<an observable condition>" \
  --why "<which requirement or gap this answers, in plain language>" \
  --claim <CLAIM-ID> --requirement <REQ-ID> --gap-status <status>
```

One bounded step per issue. If the route needs three steps, it is three issues.
`Done when` must be observable, so closing the issue is not a judgement call.

For `gap` and `growth` the renderer inserts a standing notice that the issue
describes work that has not happened yet. Do not delete it and do not phrase
the body as though the work is done.

## The disclosure gate

The issue lands on a **public** repository. What must not leak is not the
persona's identity — it is their repository — but the fact that the issue
exists because of a job search: a target employer, a posting or its slug, a
salary preference, a rejection, or wording lifted from judge feedback.

The tool derives the forbidden terms from the workspace itself and blocks on a
match. It cannot tell a leaked employer from a technology that shares its name,
so it names the term and stops. Two routes: rewrite so the issue stands on the
repository's own terms, or pass `--allow-term "<term>"` once you have looked at
the match and judged it to be about the technology. Acknowledgements are
recorded in the draft, so the decision stays auditable.

The draft is still written when the gate blocks — the workspace is private and
may hold the real wording. Only the command that would publish it is withheld.

Re-check a draft you edited by hand:

```bash
labora career-issue check <persona> <body-file>
```

**An issue that only makes sense as job-search collateral is the wrong issue.**
If it would not be worth filing had no opening ever existed, do not file it.

## Provenance

The trailer is an allowlist, not a redaction pass: claim IDs, a requirement ID,
a gap status, a date. The application slug is deliberately excluded, because a
slug encodes the target employer and the posting title.

## Filing

Print the draft, then hand the operator the exact command and stop. Wait for
them to file it. Do not run it, and do not offer to run it for the rest of a
batch.
