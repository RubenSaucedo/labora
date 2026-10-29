---
name: explore-career
description: Use only when an existing Labora persona wants to explore their actual past work, recover career stories, or clarify contribution and ownership. Do not use for public interview-process research, study planning, document organization, learning-resource research, or general brainstorming.
tools: [bash, view, glob, grep, edit, create, ask_user]
user-invocable: true
argument-hint: "<name>"
---

# Explore career

An optional conversation for recovering relevant career details the person has
not yet described. Its distinctive job is to notice adjacent work and ask about
it, not to plan studies, research hiring processes, or rate the person.

## Choose by requested outcome

Use this skill for a focused exploration of what the person actually did, not
because a request says "brainstorm" or mentions an interview.

| Request | Action |
|---|---|
| "I implemented a rollout but cannot remember which decisions I owned." | Explore that career story and attribution. |
| "Help me explain this past project accurately without inflating my role." | Explore missing facts if needed; keep already confirmed scope. |
| "Build an eighteen-day practice plan from these public hiring guides." | Research and plan directly; do not start a profile conversation. |
| "Can we brainstorm topics for spoken mock interviews?" | Clarify practice goals directly; do not assume profile enrichment. |
| "Organize my current briefs and captured application forms." | Use workspace/application preparation, not career exploration. |
| "Find source-backed resources for learning a tool." | Research resources directly, without reading the profile. |

Establish the career-exploration goal before reading profile files. If the
requested outcome is unclear, ask one direct intent question without opening
the persona. A routine drafting clarification stays a direct question; it does
not require switching to this skill.

For a matched goal, load `resume-conventions` and `resume-interview`. Read only
the relevant career/background section and material the person points to.
Do not load contact details, search preferences, or unrelated sources merely
because a persona exists. Use `resume-interview` for the shared questioning,
readback, and exact-wording confirmation method.

## How to listen

Look for unfinished edges. These are possible questions, not established facts:

- "owned the rollout" may imply success criteria, stakeholder alignment, incident handling, documentation, or adoption work;
- "debugged production issues" may imply observability, runbooks, on-call judgment, or customer impact;
- "built the API" may imply data modeling, migration, contracts, testing, reliability, or deprecation;
- "mentored teammates" may imply reviews, pairing, onboarding material, design feedback, or a standard others reused.

Ask the adjacent question neutrally:

> You mentioned owning the rollout. Did you also define what "done" looked like, or was that set before the work reached you?

Do not lead the witness:

> Since rollout owners usually define success metrics, can I say you led evaluation?

## Things this skill does not do

- No ratings, grading, fit verdicts, readiness decisions, or hiring probabilities.
- No "not a fit" language.
- No silent upgrades from contributor to owner, from team-local to organization-wide, or from qualitative to numeric.
- No placeholders inserted because an answer is missing. Ask the question instead.

## Return to the person's task

Save only person-confirmed wording, following `resume-interview`, and name its
destination in `profile/background.md`, `profile/career.md`, or
`profile/search-preferences.json` when the person is discussing preferences.
Practice answers and hypothetical examples are not confirmed career facts.

When the focused story is clear, return to the original task. Do not
automatically start drafting, tailoring, rendering, or a wider profile survey.
If no new relevant detail emerged, say so; asking a question or invoking this
skill is not by itself evidence that it added context.

End with the new confirmed details, any files changed or left unchanged, what
remains open, and the next useful question if the person wants to continue.
