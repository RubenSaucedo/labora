---
name: scaffold-persona
description: "Scaffolds a new persona workspace under <workspace>/personas/<persona>/ from templates/profile/, then asks the operator for search-preferences.json. Preferences are asked while a human is present and never templated or inferred, because a placeholder would validate and send scouts searching against invented titles. Internal procedure: the applicant-intake agent follows it after the intake interview. Operators enter through /new-applicant."
tools: [bash, view, glob, grep, edit, create, ask_user]
user-invocable: false
---
# Scaffold persona

Scaffold a new persona workspace.

Create:

```text
<workspace>/personas/<persona>/
├── profile/{contact.md,background.md}
│   ├── career.md    # optional; skip when cleaned per-review evidence covers
│   │                # the same periods, so one career has one account
│   ├── search-preferences.json   # asked, never templated (see below)
│   └── generated/   # profile-builder writes this; never hand-author it
├── evidence/performance-reviews/{raw,extracted,text,validations}
├── evidence/references/
└── applications/
```

Copy the `templates/profile/` tree into the persona's `profile/`. It carries the
human-authored sources plus an empty `generated/` folder with its ownership
contract; `resume-persona` fills that folder. Never
commit real persona data.

Then **ask the operator** for `search-preferences.json` — target titles and
levels, locations and remote preference, minimum compensation and currency,
must-haves, **companies they want to explore**, companies to avoid, job sources,
career goals, and timezone. Validate the answers against `ZSearchPreferences` in
`src/schemas/job-search.js`.

Ask for target titles in the forms employers actually post. Many companies list
"Software Engineer" and assign the level after the interview, so a list of only
"Senior …" titles hides those openings from every scout. Target companies are a
first-class field rather than prose in `notes`, because coverage is reported per
company: a named company that returned nothing is a finding, and prose cannot be
checked against a run.

It is deliberately **not** in `templates/`. Every other template file is inert
until filled, but a placeholder preferences file would validate, and scouts would
then run a real overnight search against invented titles. Preferences describe
what the operator wants, so no evidence can supply them and no agent may infer
them — ask while the operator is present, rather than leaving `job-explorer` to
discover the gap mid-run.
