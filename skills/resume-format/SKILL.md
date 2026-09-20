---
name: resume-format
description: "Deterministically validates and injects private contact data, renders ATS-safe DOCX, an editable Markdown review companion, and optional PDF, then verifies delivery-artifact field recall and section order. Never rewrites resume content."
tools: [bash, view, glob, grep]
user-invocable: true
argument-hint: "<persona> <job-slug> [--style ID]"
---

# resume-format

Load `resume-conventions`. Formatting never edits content.

## Style profiles

A style is chosen by name, not by number. Every artifact path and every recorded
stage uses that same ID, so `<ID>` below is whichever profile this run selected.

| ID | Display name | Signal |
| --- | --- | --- |
| `precision-minimal` (default) | Precision Minimal | restrained, direct, technical — Arial throughout, tight rules, narrow margins |
| `editorial-technical` | Editorial Technical | mature, deliberate, readable — Georgia headings over an Arial body, quieter rules, roomier margins |

Both profiles come from one registry (`src/lib/resume-style.js`), and the DOCX
and HTML/PDF renderers read the same semantic tokens from it. A profile carries
typography, spacing, colour and pagination only: it can never reorder, shorten,
drop or invent a line of the resume, and the two profiles must extract to
identical text.

An unrecognised ID is refused with a non-zero exit and the list of accepted IDs.
There is no fallback, because a resume rendered under a profile nobody selected
carries a visual contract nobody reviewed.

Render the Markdown review companion:

```bash
labora format-markdown \
  <application>/resume.json \
  <application>/final-resume-style-<ID>.md \
  --job <application>/job.md \
  --contact <persona>/profile/contact.md
```

The Markdown file is a review surface, not a delivery artifact or grounding
source. A human may edit it to propose wording, but the edit makes the format
stage stale. Reconcile supported changes into `resume.json`, rerun claim
validation, and regenerate every artifact. Judges and the release gate continue
to accept only DOCX/PDF.

Render DOCX:

```bash
labora format-docx \
  <application>/resume.json \
  <application>/final-resume-style-<ID>.docx \
  --style <ID> \
  --job <application>/job.md \
  --contact <persona>/profile/contact.md
```

Generate a PDF companion for visual review even when DOCX is the selected
delivery artifact. Select one delivery artifact for this run; do not assume PDF
or DOCX universally parses better.

PDF rendering drives an installed Chrome; labora does not ship a browser. If
`labora doctor` reports no PDF renderer, the DOCX path is unaffected — deliver
the DOCX, and record the missing preview as a gap. Do not substitute a
hand-described "preview" for one that was never rendered.

Render page previews:

```bash
labora render-artifact-preview \
  <application>/final-resume-style-<ID>.pdf \
  <application>/previews
```

Then run `validate-artifact` against the **selected delivery artifact** with both
`--contact <contact.md>` and `--job <job.md>`, and save
`validations/artifact.json`. It must report:

- 100% renderer-input field recall (`fieldRecallScope: renderer_input`), meaning
  every non-empty field passed to the formatter was recovered from the artifact;
- contact name/email/phone present;
- valid section order;
- no lost experience bullets.
- the selected artifact hash and, for PDF, page count.

The header is left aligned: name, then the positioning line, then contact on
two deterministic rows — location, email and phone on the first; LinkedIn,
GitHub and portfolio on the second. The rows are separate paragraphs, so the
grouping is a decision rather than an accident of where the measure runs out. A
missing field collapses inside its own row and never pulls a value up from the
next one. Contact values are injected at render time from `profile/contact.md`;
they are never stored in a style profile or a committed fixture.

Links stay real links in both renderers — `w:hyperlink` with external
relationships in DOCX, `<a href>` in HTML/PDF — and are underlined as well as
coloured so they survive greyscale printing.

The DOCX states its own profile in its core properties, so `validate-artifact`
reads the ID from the artifact instead of trusting the flag. Chromium's print
pipeline accepts no custom PDF metadata, so a PDF's profile is recorded by its
filename, `validations/artifact.json` and `run.json` instead.

Contact source validation runs before rendering. Unknown keys and multiple
destinations in one link field are errors rather than silently omitted data.

Record `format` and `validate_artifact` with `run-state`. If validation fails,
fix the formatter or source mapping; never hide the failure in a judge.
