# Phase 13 — Deterministic Automated Tests

Phase 13 completes WBS 12 and the review-queue dependency required by its HTTP integration criteria. The result is a database-independent default suite, a separate PostgreSQL boundary suite, and an explicit coverage report. None of these commands needs or calls a live LLM provider.

## Reusable fake LLM

`tests/support/fake-llm-client.ts` implements the same `LLMClient` interface as the OpenAI, Gemini, and Groq adapters. A test selects one deterministic scenario:

- valid structured analysis;
- malformed analysis;
- malformed then valid analysis;
- repeated malformed analyses;
- normalized provider error; or
- one tool request followed by a valid continuation.

The fake records requests and exposes its exact call count. It rejects calls after the configured scenario is exhausted, so an accidental extra retry fails the test instead of silently succeeding. It imports no provider SDK and performs no network access.

## Reliability coverage

The retry tests compose the fake client with the production `AnalysisService` and `ReliableAnalysisService`. They prove:

| Scenario                 | Expected behavior                                                      |
| ------------------------ | ---------------------------------------------------------------------- |
| Valid first response     | one provider call, `retryCount: 0`                                     |
| Invalid then valid       | two provider calls, `retryCount: 1`, validated result                  |
| Invalid twice            | two provider calls, fallback, `MODEL_OUTPUT_INVALID`, mandatory review |
| Permanent provider error | one provider call, `MODEL_CALL_FAILED`, mandatory review               |
| Retry limit outside 0–1  | constructor rejects the unsafe configuration                           |

Additional tests retain coverage for exhausted retryable provider errors, shared tool-round budgets, database/tool failures that must not be retried, and unexpected programming errors that must not be converted into model fallbacks.

## HTTP and PostgreSQL boundary

The Supertest/PostgreSQL suite now covers every WBS 12.6 scenario through HTTP and checks the relevant stored state:

- liveness and readiness;
- valid case creation;
- invalid case rejection with no inserted row;
- missing-case analysis with no inserted analysis run;
- successful analysis after one malformed fake response;
- fail-closed analysis after repeated malformed fake responses;
- deterministic review-queue inclusion and exclusion;
- ordered, privacy-minimized analysis history;
- atomic rollback when analysis persistence fails; and
- minimized previous-case tool metadata.

Each test creates synthetic records with unique identifiers. Cleanup deletes only the exact case IDs registered by that test, and related analysis runs are deleted before their parent cases.

## Human-review queue

`GET /api/reviews?status=required` returns only cases whose persisted application status is `REVIEW_REQUIRED`. The response deliberately contains only `id`, `status`, `createdAt`, and `updatedAt`; it excludes report descriptions, subject references, model traces, and analysis content. An unsupported or missing status query receives a structured `400` response.

The queue reflects deterministic routing already committed atomically by `TriageService`; it does not ask the model whether a case should appear.

## Commands

Run the deterministic offline suite:

```bash
npm test
```

Generate text, JSON, and HTML coverage under ignored `coverage/`:

```bash
npm run test:coverage
```

Run the PostgreSQL suite against the migrated synthetic test/development database in `DATABASE_URL`:

```bash
npm run test:integration
```

Coverage is intentionally reported without an arbitrary global percentage gate. The report is used to inspect whether schemas, deterministic review policy, bounded retry, safe fallback, API errors, and persistence paths are exercised. High line coverage does not establish model quality, legal compliance, operational security, or production safety; those require separate evaluation and deployment controls.
