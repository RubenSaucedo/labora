---
name: review-resume
description: Use when a rendered Labora resume needs an advisory cold read against a posting before the person decides whether to send it.
tools: [bash, view, glob, grep, task, ask_user]
user-invocable: true
argument-hint: "<name> <job-slug>"
---

# Review resume

A review is advice. It is not a pass/fail result, a rating, or a hiring forecast. Nothing here decides whether to send.

## Boundary

Dispatch `resume-reviewer`. The reviewer reads only:

- the rendered resume artifact, preferably DOCX text or PDF text from `labora inspect artifact`;
- the posting in `applications/<job-slug>/job.md`.

Do not give the reviewer the profile, sources, private notes, or prior reasoning. The point is an honest reader reaction to the document a recruiter or engineer would see.

## Steps

1. Ensure a rendered artifact exists. If not, suggest `render-resume`.
2. Run `labora inspect artifact <artifact>` so the reviewer sees parser-visible text, not assumptions about layout.
3. Dispatch `resume-reviewer` with the inspected artifact text and the posting.
4. Report suggestions as suggestions. Use language like "The reviewer suggests..." or "A reader may miss...".
5. Ask the person which suggestions to accept before editing `resume.json`.

## The reviewer must not emit

- "not a fit";
- a hiring probability;
- a pass/fail verdict;
- a statement that a concern prevents sending.

A useful review names the concern and the smallest next action: clarify a bullet, move proof higher, add a missing keyword if the person confirms it, or leave it as is because the tradeoff is acceptable.
