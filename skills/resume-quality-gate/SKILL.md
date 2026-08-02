---
name: resume-quality-gate
description: "Runs after deterministic validations and all judges, aggregates them into release.json, permits one bounded truthful remediation cycle, and blocks sending unless state is send_ready."
tools: [bash, view, glob, grep, edit, create]
---

# resume-quality-gate

Load `resume-conventions`.

Run `node src/tools/quality-gate.js <application-dir> --style <N> --artifact
<selected-delivery-artifact>`. The tool writes
`release.json`.

- `blocked`: factual/artifact/strategy failure, unsupported hard eligibility,
  missing judge, or hard negative verdict. Never send.
- `human_review`: no hard blocker, but judge uncertainty or disagreement remains.
- Missing core requirements route to human review; preferred and soft signals do
  not automatically block release.
- `send_ready`: deterministic gates pass and judges clear their release bars.

If blocked or reviewable findings can be improved using existing verified
claims, run one remediation cycle:

`resume-tailor -> resume-format -> validations -> judges -> quality-gate`.

Do not remediate a real experience gap by inventing it. Record `quality_gate`
with `run-state`. Human approval remains mandatory even for `send_ready`.
