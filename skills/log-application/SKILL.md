---
name: log-application
description: Use when recording application funnel events, outcomes, notes, or follow-up status for an existing Labora application folder.
tools: [bash, view, glob, grep, edit, create, ask_user]
user-invocable: true
argument-hint: "<name> <job-slug>"
---

# Log application

Outcome logging records what happened. It does not explain why it happened. A rejection, silence, screen, interview, offer, or withdrawal may have many causes Labora cannot observe.

## Steps

1. Locate `personas/<name>/applications/<job-slug>/`.
2. Ask what event to record, when it happened, and any neutral notes the person wants kept.
3. Record or show outcomes with:

```bash
labora search outcome <application-dir> show
labora search outcome <application-dir> record <event>
```

4. Keep notes factual: dates, stage, contact channel, follow-up action, and the person's decision.

## Do not infer causes

Do not write "rejected because the resume lacked X", "advanced because the keyword matched", or "silence means no fit". The log is a funnel record, not an explanation engine.

End with the recorded event and any next reminder the person asked for.
