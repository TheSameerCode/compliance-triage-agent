# Phase 8: Deterministic Human-Review Policy

## Objective

Phase 8 makes routing an application decision rather than a model decision. A validated model analysis is only input to a pure policy function; the model cannot suppress a mandatory-review rule.

```text
validated CaseAnalysis
        |
        v
deterministic review policy
        |
        +--> explicit review reasons
        |
        v
atomic transaction
        +--> immutable AnalysisRun
        +--> Case.status
        |
        v
API response
```

The external model call and its bounded retry happen before the transaction begins. The transaction contains only the final analysis-run insert and parent-case status update.

## Policy rules

`evaluateReviewPolicy` is a pure function with no network or database dependency. It requires review when any of these rules applies:

1. category is `safeguarding`;
2. severity is `high`;
3. confidence is strictly below `HUMAN_REVIEW_CONFIDENCE_THRESHOLD`;
4. `missingInformation` is non-empty;
5. `modelSuggestsHumanReview` is true.

All applicable reasons are retained in that deterministic order. Confidence equal to the threshold is not considered low.

A model result such as safeguarding, high severity, confidence `0.99`, and `modelSuggestsHumanReview: false` still produces both `SAFEGUARDING_CATEGORY` and `HIGH_SEVERITY`. Model confidence and model suggestions cannot negate application policy.

## Persistence and API

`POST /api/cases/:id/analyze` now performs the complete implemented workflow:

1. load the stored case input;
2. call the provider-neutral validated/reliable analysis stack;
3. apply deterministic review policy to a valid result, or retain the mandatory-review fallback;
4. persist the immutable analysis run and case status atomically;
5. return model analysis plus the application-owned review decision.

Completed analyses set the parent case to `ANALYZED` or `REVIEW_REQUIRED`. Fallbacks always set it to `REVIEW_REQUIRED`, persist `analysis: null`, and return a degraded HTTP `200` response with the sanitized failure code. Database failure returns a sanitized non-2xx response and is never reported as persisted.

Public responses and retrieval history omit prompts, raw provider payloads, provider response IDs, token counts, latency, and cost. Operational logs contain IDs and decision metadata but never the case narrative or model output.

## Verification

The tests cover:

- every individual mandatory-review rule;
- a benign, complete negative/control case;
- confidence below, equal to, and above the configured threshold;
- retention of multiple policy reasons;
- the explicit model-override attempt from WBS 7.2;
- policy application after analysis and before persistence;
- successful and fallback endpoint responses;
- persisted review reasons matching both the analyze response and retrieval API;
- one analysis run per execution and atomic parent-case routing;
- a forced database write failure leaving the case unchanged with no analysis row.

Normal unit/API tests use fakes and require no provider key. PostgreSQL verification remains separate:

```bash
npm test
npm run test:integration
```
