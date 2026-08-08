---
name: application-outcomes
description: "Records objective, operator-confirmed application funnel events such as submission, recruiter screen, interview, rejection, and offer. It never infers causality or claims that a resume caused an outcome."
tools: [bash, view]
user-invocable: false
---

# application-outcomes

Load `resume-conventions`.

Outcome tracking is manual and factual. Never infer an event from silence, email
content, or browser state; record only what the operator confirms.

Show an application's history:

```bash
labora application-outcome <application-dir> show
```

Record an event:

```bash
labora application-outcome <application-dir> record recruiter_screen \
  --at <ISO timestamp> \
  --channel <email|phone|portal|referral|other> \
  --note "<short factual note>"
```

The file lives at `applications/<slug>/outcome.json`. These events can describe
funnel conversion over time, but they are observational and confounded by role,
company, timing, referrals, market conditions, and candidate competition. Never
present them as proof that a prompt, score, or resume caused an interview.
