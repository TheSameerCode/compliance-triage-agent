# Phase 7: Retry, Failure Handling, and Safe Fallback

## Objective

Phase 7 adds a bounded reliability layer around the validated analysis service. Model failure is represented as an explicit application state; it is never converted into fabricated analysis.

```text
validated analysis attempt
        |
        +--> valid ----------------------> typed analysis + retryCount
        |
        +--> retryable failure
        |       |
        |       +--> retry once at most
        |                |
        |                +--> valid -----> typed analysis + retryCount = 1
        |                |
        |                +--> failure ---> mandatory-review fallback
        |
        +--> permanent model failure ----> mandatory-review fallback
```

The loop is iterative rather than recursive, and the constructor rejects retry limits outside `0..1`.

## Normalized errors

All failures used by application logic extend the provider-independent `ApplicationError` contract and carry a stable code plus retryability metadata.

| Failure family             | Example code              | Model retry behavior               |
| -------------------------- | ------------------------- | ---------------------------------- |
| Malformed model output     | `MODEL_OUTPUT_INVALID`    | Retry once by default              |
| Transient provider failure | `TIMEOUT`, `RATE_LIMITED` | Retry when marked retryable        |
| Permanent provider failure | `AUTHENTICATION_FAILED`   | Do not retry; return fallback      |
| Tool failure               | `TOOL_EXECUTION_FAILED`   | Do not retry in the model pipeline |
| Database failure           | `DATABASE_FAILURE`        | Do not retry in the model pipeline |

Provider SDK error classes remain confined to provider adapters. Causes may be retained internally for debugging, but public messages and fallback results expose no provider payload, credentials, report content, or stack details.

## Fallback contract

Repeated malformed output produces:

```json
{
  "type": "fallback",
  "analysisStatus": "fallback",
  "analysis": null,
  "reviewDecision": {
    "reviewRequired": true,
    "reviewReasons": ["MODEL_OUTPUT_INVALID"]
  },
  "retryCount": 1,
  "failure": { "code": "MODEL_OUTPUT_INVALID" }
}
```

Provider failures use `MODEL_CALL_FAILED` as the review reason while retaining the normalized provider failure code for operational tracing. The fallback never supplies placeholder category, severity, summary, or confidence values.

## API behavior decision

When the analyze endpoint and atomic persistence are implemented, a successfully persisted fallback will return a degraded successful response with HTTP `200`, `analysisStatus: "fallback"`, and `reviewRequired: true`. This means the analysis request was handled safely, not that AI analysis succeeded. Database/persistence failure will remain a non-2xx error and must never be reported as a persisted fallback.

The endpoint and persistence are not connected in this phase. WBS 5.3 and 5.4 require the deterministic review policy and atomic database transaction, so WBS 6.3 and 6.4 remain partial until that path is complete.

## Verification

Database-independent tests prove:

- invalid then valid output succeeds with `retryCount = 1`;
- repeated invalid output produces a schema-valid mandatory-review fallback;
- retryable provider errors receive at most one retry;
- repeated timeouts produce a traceable provider-error fallback;
- permanent provider failures are not retried;
- database, tool, and unknown failures are not silently converted or retried;
- retry can be disabled and unsafe retry limits are rejected.

Run the suite with:

```bash
npm test
npm run typecheck
```
