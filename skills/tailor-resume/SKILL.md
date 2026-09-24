---
name: tailor-resume
description: Use when adapting an existing Labora resume for a specific posting or application folder without starting the resume from scratch.
tools: [bash, view, glob, grep, edit, create, task, ask_user]
user-invocable: true
argument-hint: "<name> <job-slug>"
---

# Tailor resume

Tailoring is mostly selection, ordering, and emphasis. Rewriting approved language is expensive: it can blur the person's voice, introduce scope drift, and make them re-approve work they already trusted.

## Load first

Use `resume-conventions`, `resume-interview`, and `resume-writing`.

## Inputs

- `personas/<name>/profile/`
- `personas/<name>/applications/<job-slug>/job.md`
- the existing `resume.json`

If job context is missing, run `labora job parse <job.md>` and `labora job analyze <job.md> [job-spec.json]`.

## Tailoring rules

1. Preserve approved wording unless there is a reason to change it. Say the reason: target relevance, clarity, section fit, confidentiality, metric context, or a confirmed correction from the person.
2. Prefer moving a stronger bullet up, cutting a weaker duplicate, or changing the skills order before rewriting sentences.
3. Keep contribution level exact. Ask "did you lead this or contribute to it?" rather than choosing the stronger verb.
4. Do not copy seniority, scale, ownership, or numbers from the posting into the resume.
5. If a posting asks for something adjacent to known work, ask a concrete question. Do not count the adjacency as experience and do not drop it as a miss.
6. Put assistant-proposed unconfirmed wording in `notes[]` or the conversation until the person accepts it.

## Flow

1. Read the existing resume with `labora inspect resume <resume.json>`.
2. Read and parse the posting.
3. Identify the smallest set of changes that improves relevance.
4. Dispatch `resume-writer` only for the revised `resume.json`, with instructions to preserve approved wording by default.
5. Save the adapted resume and summarize every material change in plain language.

End with the updated path, the changes made, and any questions that would improve the resume if the person wants to answer them.
