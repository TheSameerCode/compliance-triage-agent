# Phase 12: Evaluation Harness and Regression Gates

## Objective

Phase 12 turns the versioned `golden-v1` dataset into a repeatable, provider-backed evaluation workflow. It runs the same validated analysis and deterministic review-policy layers used by the application, reports quality and operational metrics, writes a privacy-minimized artifact, and exits non-zero when a committed regression gate fails.

The evaluator does not use the case database or prior-case tool. It evaluates each synthetic fixture independently and sequentially against the configured LLM provider.

## Running an evaluation

Configure `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_API_KEY` in the ignored `.env` file, then run:

```bash
npm run eval
```

The command:

1. loads and runtime-validates every sorted fixture file;
2. identifies the dataset by version and SHA-256 content hash;
3. executes the provider through `AnalysisService` and `ReliableAnalysisService`;
4. applies the deterministic review policy to schema-valid output;
5. compares exact or explicit `oneOf` category/severity expectations;
6. checks the review decision and required deterministic reasons;
7. calculates metrics and gates;
8. prints a human summary and an `EVAL_RESULT_JSON=...` machine summary;
9. writes `evals/results/latest.json` before setting the process exit code.

Provider quota is operational state, not model quality. If an account requires pacing, set an interval locally without changing fixtures or thresholds:

```dotenv
EVAL_REQUEST_INTERVAL_MS=9000
```

The interval is applied between fixtures and is bounded to 60 seconds. Groq defaults to 9 seconds because its free tier commonly needs pacing; other providers default to zero. An explicit environment value overrides either default. Automated evaluator tests inject a fake wait function and never sleep or call a network provider.

## Metrics

The report calculates—not hard-codes—the following metrics:

- total cases;
- schema-valid response count and rate;
- category accuracy;
- severity accuracy;
- final `reviewRequired` accuracy after application policy;
- critical human-review recall over the tagged subset;
- total and average retry count;
- average, p50, and p95 end-to-end fixture latency;
- input, output, and total tokens plus usage-coverage count.

All accuracy/recall fields contain numerator, denominator, and rate. A fallback counts as schema/category/severity failure but remains fail-closed for review recall. Provider and execution failures retain the fixture ID and a sanitized code.

Estimated monetary cost is reported as unavailable. The project has no reviewed pricing configuration and intentionally does not guess from potentially stale public prices.

## Regression gates

The gates live only in `evals/thresholds.ts`:

| Metric                     | Minimum |
| -------------------------- | ------: |
| Schema-valid response rate |    100% |
| Critical-review recall     |    100% |
| Review-required accuracy   |     95% |
| Category accuracy          |     85% |

Severity accuracy and required-review-reason misses remain visible as fixture failures even though they are not MVP gates. A report may therefore pass its committed gates while still showing improvement opportunities.

These are project regression gates, not production safety, legal, compliance, fairness, or model-quality guarantees. They are based on 30 synthetic examples and must not be generalized to real-world performance.

## Report artifact and privacy

`evals/results/latest.json` contains:

- timestamp, provider, model, and prompt version;
- dataset version/hash and case count;
- thresholds, calculated metrics, and gate results;
- bounded per-fixture classifications, review decisions, usage, latency, and failure codes;
- failing fixture IDs and mismatch labels.

It does not contain report descriptions, prompts, raw provider output, provider response IDs, hidden reasoning, API keys, or exception causes. Generated JSON reports are git-ignored; `.gitkeep` preserves the output directory.

## Comparing model or prompt configurations

Save two reports produced from the same dataset, then run:

```bash
npm run eval:compare -- path/to/baseline.json path/to/candidate.json
```

The comparison validates both report schemas and rejects different dataset hashes. It prints human and `EVAL_COMPARISON_JSON=...` machine output, labeling each core metric as improved, regressed, or unchanged. A critical-review recall regression is prominently identified and makes the comparison command exit non-zero.

## Observed synthetic baseline

On 22 September 2026, `openai/gpt-oss-20b` through Groq was evaluated with a 9-second interval against the unchanged `golden-v1` dataset:

| Metric                     | Result        |
| -------------------------- | ------------- |
| Schema-valid response rate | 30/30 (100%)  |
| Category accuracy          | 30/30 (100%)  |
| Severity accuracy          | 24/30 (80%)   |
| Review-required accuracy   | 29/30 (96.7%) |
| Critical-review recall     | 29/29 (100%)  |
| Average retries            | 0.000         |
| Token usage                | 33,415 total  |
| Estimated cost             | Unavailable   |

All four committed gates passed. Seven fixtures still exposed severity, review-reason, or negative-control misses and remain visible in the local report. An earlier unpaced attempt was rate-limited after eight successful calls; its failed gates were retained rather than weakening thresholds. Live results can vary with provider/model revisions and account limits.

## Deterministic verification

Unit tests use injected fake analyses and cover:

- a complete 30-case passing run;
- provider fallback tied to the correct fixture ID;
- exact numerator/denominator/rate calculations;
- failing gates and non-zero exit-code selection;
- latency percentiles, retries, token totals, and unavailable cost;
- pacing without real delay;
- runtime-validated safe JSON artifact generation;
- improvement/regression comparison and dataset mismatch rejection;
- explicit critical-review recall regression highlighting.

```bash
npm test -- --run tests/unit/evaluator.test.ts tests/unit/evaluation-comparison.test.ts
```
