# Agent instructions for this workspace

This workspace holds **personal career data**: evidence, claims, resumes and
live job applications. Read this before publishing anything anywhere.

## Nothing personal leaves this workspace

**Mandatory.** Tools have public issue trackers, and a defect is almost always
found *while working on a real application* — so the posting, the employer, the
title, the persona and application slugs and the resume text are exactly what is
in front of you when you sit down to report it. Convenience and disclosure point
the same way. Apply this deliberately; do not expect to notice.

Never publish — in an issue, pull request, commit message, gist, pasted log or
screenshot:

- **Names** — the persona, a recruiter, a hiring manager, a colleague, a
  reference.
- **Employers or companies**, current, past or target, including the one behind
  the posting that motivated the report.
- **Job titles or seniority** attached to a real person, and the text, URL or
  slug of a real posting.
- **Contact details, credentials, tokens, internal hostnames, registry URLs,
  ticket IDs.**
- **Paths containing a username, persona slug or application slug** — including
  inside a stack trace, log excerpt or filename.
- **Verbatim excerpts** from evidence, reviews, resume bullets, claims or judge
  feedback. A quoted bullet identifies a person as surely as a name.

Instead, describe the **class** of problem: the *shape* of the input, never the
input. Reproduce with the synthetic `example` persona that ships with labora —
it exists for this.

**Publication is permanent.** Editing does not retract: the original stays in
edit history and was already sent to subscribers. Check before publishing, every
time — including when the request you were given contains real details.

Never drop a genuine finding over this rule. Rewrite it generically. If it
cannot be generalised without losing it, keep it here instead.

## Everything else

labora's own conventions — paths, provenance, claim grounding, release gates —
live in the plugin's `resume-conventions` skill. Load it before any resume task
rather than restating it here, so this file cannot drift from it.
