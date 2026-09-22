# Metric context

Every number below is synthetic and must never be copied into a resume.

## Two judgments, not one

1. Is the metric supported by evidence?
2. Is the metric understandable and useful to a reader who does not have the
   evidence context?

Claim validation answers the first and answers it well. The second has to be
answered separately, because a number can be measured, attributable and
completely accurate while making an accomplishment look weaker — or simply
different — from what was actually measured.

Synthetic:

> Reduced P95 agent latency from 42 seconds to 11 seconds.

A reader may take `11 seconds` as time-to-first-token for one model call and
conclude the system stayed slow. The evidence may instead measure full response
completion across a shared multi-service path that does not stream partial
output. The sentence is numerically true. The measurement boundary is invisible,
and the candidate pays for it.

## Describe the number before rendering it

Record a `ZMetricContext` for every metric-bearing span:

1. **Measured object** — what operation, workflow or outcome was measured?
2. **Boundary** — one component, an application pipeline, or the complete
   end-to-end path?
3. **Latency semantics** — first byte/token, first useful output, full
   completion, or another milestone?
4. **Statistic and environment** — average, median, percentile; benchmark,
   manual observation, staging, or production telemetry?
5. **Comparator** — baseline, endpoint, relative change, time window.
6. **Attribution boundary** — what did the candidate change, and which
   surrounding systems were shared or outside their control?
7. **Disclosure boundary** — are raw values externally safe, or may only a
   generalized result be published?
8. **Reader-interpretation risk** — without the missing context, is the likely
   interpretation materially different from the measured claim?

## Then choose the representation deliberately

- **Absolute** when the unit and endpoint are meaningful to the target reader
  and the necessary context fits naturally.
- **Relative change plus measurement scope** when an absolute endpoint is
  confidential or likely to be judged against the wrong mental model.
- **Concrete qualitative consequence** when neither can be made interpretable
  without turning the bullet into an architecture explanation.

Three things are never acceptable:

- **Never replace an ambiguous absolute with a naked percentage.** The
  percentage still needs the measured object, boundary and attributable action;
  swapping units moves the ambiguity rather than removing it.
- **Never invent** streaming behaviour, component timings, user impact or
  architecture rationale to make a metric look better.
- **Never weaken or conceal an unfavourable result.** Choosing a representation
  is about faithfulness, not flattery.

Synthetic repair of the example above:

> Helped reduce P95 end-to-end completion latency by approximately 74% across a
> shared, multi-service agent path through application-level pipeline and
> model-configuration changes.

It preserves the measurable improvement, says the measurement covers completion
across a larger path, and limits attribution to the work actually controlled.
Topology and raw endpoint remain interview context.

## Compression failures to watch for

- **Percentile flattening.** Dropping `P95` from approved wording makes a
  tail-latency result read as an average. The sentence got shorter and the claim
  got larger. Route: `keep`.
- **Attribution inflation.** `Led the work that cut…` for a result recorded as
  `shared_platform`. This is an evidence boundary, so it is an error rather than
  advice. Keep `helped`, `contributed`, `partnered` when the path was shared.
- **Environment erasure.** A benchmark or manual figure that does not say so
  reads as production telemetry.
- **Instrumentation as causality.** Measurement tooling that diagnosed a problem
  did not, by itself, fix it. Separate the optimisation from the measurement
  system.

## Diagnostics

| Diagnostic | Trigger | Severity |
|---|---|---|
| `metric_context_absent` | A number is rendered with no recorded context | warning |
| `metric_missing_measurement_boundary` | The value appears without naming what was measured | warning |
| `latency_semantics_ambiguous` | First output vs completion is material and unstated | warning (error when the sentence states the wrong one) |
| `metric_statistic_flattened` | A percentile or median renders unlabelled, or is dropped from approved wording | warning |
| `naked_percentage_without_boundary` | A percentage with no measured object or comparison | warning |
| `metric_environment_omitted` | Benchmark, manual, staging or estimate status changes the meaning and is unstated | warning |
| `metric_attribution_scope_mismatch` | Ownership wording exceeds the supported contribution | **error** |
| `metric_disclosure_conflict` | The rendered value exceeds the evidence record's disclosure boundary | **error** |
| `metric_not_in_source` | The printed number is not in the mapped claim | **error** |
| `metric_requires_excessive_context` | An absolute rated high interpretation risk was kept | warning |

The three errors are the three that cross a boundary that is not an editorial
preference. Everything else is reported and left to the operator.
