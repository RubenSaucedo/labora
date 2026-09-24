# Metric context

Every number below is synthetic and must never be copied into a resume.

## Two judgments, not one

1. Did the person confirm the metric and its source?
2. Is the metric understandable and useful to a reader who does not have the full context?

A number can be accurate while making an accomplishment look weaker, stronger, or simply different from what was measured.

Synthetic:

> Reduced P95 agent latency from 42 seconds to 11 seconds.

A reader may take `11 seconds` as time-to-first-token for one model call. The person may mean full response completion across a shared multi-service path that does not stream partial output. The number is not enough; the measurement boundary matters.

## Ask for the number's shape before rendering it

For every metric-bearing line, ask about:

1. measured object: operation, workflow, or outcome;
2. boundary: component, application pipeline, or end-to-end path;
3. latency semantics: first byte/token, first useful output, full completion, or another milestone;
4. statistic and environment: average, median, percentile; benchmark, manual observation, staging, or production telemetry;
5. comparator: starting point, endpoint, relative change, time window;
6. attribution boundary: what the person changed and what was shared;
7. disclosure boundary: raw values or generalized result;
8. reader-interpretation risk.

## Choose the representation deliberately

- **Absolute** when the unit and endpoint are meaningful and the context fits.
- **Relative change plus measurement scope** when a raw endpoint is confidential or likely to be misread.
- **Concrete qualitative consequence** when neither number can be made clear without turning the bullet into an architecture explanation.

Never replace an ambiguous absolute with a naked percentage. Never invent streaming behaviour, component timings, user impact, or architecture rationale to make a metric look better. Never hide an unfavourable result; choose faithful representation, not flattery.

Synthetic repair:

> Helped reduce P95 end-to-end completion latency by approximately 74% across a shared, multi-service agent path through application-level pipeline and model-configuration changes.

It preserves the improvement, names the measurement boundary, and limits attribution to the work controlled.

## Compression failures to watch for

- **Percentile flattening:** dropping `P95` makes tail latency read as an average.
- **Attribution inflation:** `led` for a shared result. Keep `helped`, `contributed`, or `partnered` when that is the truth.
- **Environment erasure:** a benchmark or manual figure that does not say so reads as production telemetry.
- **Instrumentation as causality:** measurement tooling that diagnosed a problem did not, by itself, fix it.
