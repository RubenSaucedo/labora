# Exact answer mapping

The same pure planner produces the review brief and live-entry decisions.
Bindings are explicit question IDs from the capture, never guesses based on a
posting or overlapping labels.

All examples are synthetic. Store the bank only in the operator's private
persona workspace, under its declared answer directory.

```json
{
  "schemaVersion": "1.0",
  "answers": {
    "preferred-name": {
      "kind": "fact",
      "value": "Synthetic Example",
      "confirmation": {
        "reference": "operator-confirmation-a",
        "at": "2026-10-01T10:00:00Z",
        "valueSha256": "<hash of the exact JSON value>"
      }
    },
    "authorization-us": {
      "kind": "legal",
      "intent": "work_authorization",
      "country": "US",
      "value": null
    },
    "motivation-a": {
      "kind": "essay",
      "value": "An exact synthetic proposal awaiting review."
    }
  },
  "bindings": {
    "captured-name-question": { "answer": "preferred-name" },
    "captured-authorization-question": { "answer": "authorization-us" },
    "captured-motivation-question": { "answer": "motivation-a" }
  }
}
```

`valueSha256` is SHA-256 of UTF-8 `JSON.stringify(value)`, including the JSON
quotes for a string. The plan exposes this hash for each draft. A confirmation
or approval must be recorded only after the person confirms the exact value.
Changing a confirmed value without recording a new confirmation invalidates it.

For `kind: "draft"` or `kind: "essay"`, add an approval only after exact-text
sign-off, scoped to the current opening and captured question:

```json
{
  "approval": {
    "reference": "operator-exact-text-approval-a",
    "at": "2026-10-01T10:00:00Z",
    "openingId": "opening-a",
    "questionId": "captured-motivation-question",
    "valueSha256": "<hash of the exact proposed JSON value>"
  }
}
```

Shared `fact` values require exact-value `confirmation`. Legal answers require
the same confirmation plus `kind: "legal"`, an ISO country code and one exact
intent: `work_authorization`, `authorization_without_sponsorship`,
`sponsorship_needed`, `authorization_type`, or `citizenship`. Country comes
from an explicit question jurisdiction or the opening's authored `country`
context, never residence or employment history. Unsupported or ambiguous
jurisdictions stay unanswered; clarify the capture/context rather than guessing.
An unresolved legal value is null, not false. Captured option values must match
exactly; the planner does not invert, translate or coerce answers.

| Plan status | Meaning |
| --- | --- |
| `ready` | Exact confirmed fact, scoped legal answer, or verified shared resume. |
| `confirm` | Draft text; entry requires exact-text, question and opening approval. |
| `essay` | Long-form draft; the same exact-text approval rule applies. |
| `blocked` | Unanswered legal field; ask its exact intent and jurisdiction. |
| `self_id` | Question definition only; no personal value is retained or entered. |
| `manual` | Operator action or unsupported control; never entered by the tool. |

A required manual step can be acknowledged on its binding:

```json
{
  "acknowledgement": {
    "reference": "operator-manual-step-a",
    "at": "2026-10-01T10:00:00Z",
    "openingId": "opening-a",
    "questionId": "captured-manual-question"
  }
}
```

This permits an entry pass for other resolved fields, not that control. Required
unanswered legal fields and unapproved drafts still need an answer or approval.
Optional unanswered or unsupported fields remain visibly incomplete. The tool
never changes submission state to submitted.

Saved plans bind the captured form and bank bytes and share their exact mapping
with entry. If either changes, regenerate and read back the plan; do not edit
the generated brief into an approval. A live recheck also compares the page's
question definitions, choices, constraints, selectors and submit controls.
