## What this changes

<!-- What behaviour is different after this PR, and why it should be. -->

## Why

<!-- The diff shows what changed. This is where the reasoning goes. -->

## Checklist

- [ ] `npm test` passes
- [ ] No real persona data is staged (`git status` shows nothing under
      `data/personas/<a-real-name>/`)
- [ ] Fixtures, docs and examples use synthetic names — no real employer,
      person, or company someone is actually applying to
- [ ] New behaviour has a test; a changed rule has its assertion updated in the
      same commit
- [ ] Any new test was **mutation-verified**: the rule was broken, the test
      failed, the rule was restored
- [ ] No agent boundary was widened (browser tools stay with acquisition
      agents; the tailor still cannot see raw evidence; judges still see only
      the artifact and the job)
- [ ] No gate was lowered (`fitFloor`, `consensusThreshold`, `minAgreement`) to
      make a run produce more output
- [ ] No new dependency, or the PR explains why it cannot be avoided

## What I did not verify

<!-- An honest gap here is more useful than a confident claim that does not
     hold. Say what you could not test and why. -->
