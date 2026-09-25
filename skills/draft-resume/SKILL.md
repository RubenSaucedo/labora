---
name: draft-resume
description: Use when composing a first general resume or an application resume from an existing Labora persona and conversation, before rendering artifacts.
tools: [bash, view, glob, grep, edit, create, task, ask_user]
user-invocable: true
argument-hint: "<name> [job-slug]"
---

# Draft resume

A draft is a writing act, not a proof exercise. The person supplies the career; Labora chooses structure, emphasis, and clear language.

## Load first

Use `resume-conventions`, `resume-interview`, and `resume-writing` before drafting. If a résumé already exists at the target path, load `resume-editorial` too and edit it rather than replacing it.

## Inputs

- Persona profile: `personas/<name>/profile/`.
- Optional application: `personas/<name>/applications/<job-slug>/job.md` and `job-spec.json` if present.
- Any conversation from this session the person has confirmed.

If a job is present and `job-spec.json` is missing, run `labora job parse <job.md>` and `labora job analyze <job.md> [job-spec.json]` for context. The analysis informs the conversation; it does not decide what may be written.

## Drafting flow

1. Inspect the profile and application files.
2. Ask about missing essentials before writing around them: target role, preferred title, date boundaries, contribution level, confidential details, and metrics whose context is unclear.
3. Dispatch `resume-writer` with the profile, confirmed conversation notes, and job context if any. The writer composes `resume.json`; it does not render.
4. Review the draft yourself for obvious scope inflation, vague placeholders, and section placement. Then read it as a whole document, using the whole-document read in `resume-editorial` — repeated openings, uniform clause shapes, noun stacks, and a Summary that previews a bullet instead of interpreting the career.
5. If the draft contains assistant-suggested wording the person has not confirmed, label it plainly in the conversation and ask them to accept, edit, or reject it.
6. Save `applications/<job-slug>/resume.json`. If no job slug is supplied, use `applications/general/resume.json` unless the person chooses a different slug.
7. Run `labora inspect resume <resume.json>` and read the plain text back for review.

## Output

Report the path written, the wording that needs confirmation, and the next useful step, usually `render-resume`. This stage does not decide whether to send; it simply leaves open questions visible.
