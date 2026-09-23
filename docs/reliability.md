# Reliability and Safety Invariants

## Purpose

The Compliance Triage Agent assists with structuring and routing synthetic compliance reports. It does not decide whether an allegation is true, resolve a case, or recommend a legal, disciplinary, safeguarding, or employment outcome.

The core control model is:

```text
LLM assists.
Application validates.
Deterministic policy overrides.
Human decides.
```

Model output is external, untrusted input. Provider-side structured-output features may improve conformance, but they do not replace application-owned runtime validation.

## Enforcement layers

1. **Input contract:** bounds and validates case data before persistence or model use.
2. **Model-output contract:** accepts only the narrow analysis schema.
3. **Deterministic policy:** converts validated analysis and failure states into auditable routing decisions.
4. **Persistence boundary:** stores analysis and routing metadata without granting the model authority over case resolution.
5. **Tool boundary:** exposes only explicit, validated, read-only operations.
6. **Human review:** owns decisions affecting people, allegations, or compliance outcomes.

## Invariant matrix

The status column describes the controls currently enforced by the implementation.

| ID     | Invariant                                                                             | Status                                     | Implementation location                                                                         | Test evidence                                                                                                                |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| INV-01 | No LLM response is consumed before local schema validation.                           | Enforced                                   | `src/domain/analysis.schemas.ts`; `src/services/analysis.service.ts`                            | `tests/unit/analysis.schemas.test.ts`; `tests/unit/analysis.service.test.ts` rejects malformed output through the service    |
| INV-02 | Safeguarding cases always require human review.                                       | Enforced                                   | `src/domain/review-policy.ts`                                                                   | `tests/unit/review-policy.test.ts` proves high confidence and a false model suggestion cannot bypass review                  |
| INV-03 | High-severity cases always require human review.                                      | Enforced                                   | `src/domain/review-policy.ts`                                                                   | `tests/unit/review-policy.test.ts` covers the rule independently and together with safeguarding                              |
| INV-04 | Low-confidence cases always require human review.                                     | Enforced                                   | Threshold in `src/config/env.ts`; policy in `src/domain/review-policy.ts`                       | `tests/unit/review-policy.test.ts` covers below, equal to, and above the configured threshold                                |
| INV-05 | Cases with material missing information require human review.                         | Enforced                                   | `src/domain/review-policy.ts`                                                                   | `tests/unit/review-policy.test.ts` covers empty and non-empty `missingInformation` arrays                                    |
| INV-06 | Repeated malformed model output produces a fallback requiring human review.           | Enforced and persisted                     | `src/services/reliable-analysis.service.ts`; `src/services/triage.service.ts`                   | Reliability unit tests plus API/PostgreSQL integration tests cover persisted fallback behavior                               |
| INV-07 | Provider failure produces human review or an explicit failed/fallback analysis state. | Enforced and persisted                     | `src/llm/llm-errors.ts`; reliability and triage services                                        | Unit/API/PostgreSQL tests cover retryable, exhausted, permanent, and persisted provider-failure paths                        |
| INV-08 | The model cannot close or resolve a case.                                             | Enforced through domain and API boundaries | Model schema, deterministic policy, triage service, and analyze route                           | Strict schemas reject application-owned fields; API responses expose analysis and review routing but no close/resolve action |
| INV-09 | The model cannot make guilt, legal, disciplinary, or employment decisions.            | Enforced by schema, prompt, and API        | `src/domain/analysis.schemas.ts`; `src/llm/prompts/triage-v1.ts`; prompt-injection fixture      | Schema and prompt tests reject decision fields and verify that embedded instructions remain untrusted report data            |
| INV-10 | Model tool access is explicit, read-only, allow-listed, and bounded.                  | Enforced                                   | `src/tools/tool-registry.ts`; `src/tools/previous-cases.tool.ts`; analysis/reliability services | Registry, service, repository, and PostgreSQL tests cover validation, minimization, failures, and the one-round limit        |

## Current contract guarantees

### Case input

`src/domain/case.schemas.ts`:

- trims descriptions;
- requires at least 20 characters;
- caps descriptions at 12,000 characters;
- bounds optional metadata;
- restricts pseudonymous subject references to safe identifier characters;
- rejects unknown request fields.

### Model analysis

`src/domain/analysis.schemas.ts` permits only:

- an allow-listed category and severity;
- a bounded neutral summary;
- bounded string arrays for missing information and indicators;
- confidence from 0 through 1;
- `modelSuggestsHumanReview`, which is explicitly a suggestion rather than a routing decision.

The model schema does not include fields for closing cases, deciding guilt, choosing sanctions, or making legal/employment decisions.

### Application decision

`src/domain/decision.schemas.ts` owns review routing:

- required review must include at least one allow-listed reason;
- no-review decisions must have an empty reason list;
- completed outcomes contain validated analysis and a separate application decision;
- fallback outcomes contain no model analysis;
- every fallback requires human review;
- every fallback identifies invalid model output or a provider call failure.

These schemas define valid states. The deterministic review policy chooses those states independently of the prompt.

## Failure behavior

| Failure                               | Required behavior                                                           |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Invalid case input                    | Reject before persistence or model invocation                               |
| Invalid model output on first attempt | Record validation failure and retry once                                    |
| Invalid model output after retry      | Return/persist fallback with `MODEL_OUTPUT_INVALID` and human review        |
| Provider timeout or API error         | Normalize the error and return/persist fallback with `MODEL_CALL_FAILED`    |
| Unsupported tool request              | Reject with a controlled tool error; do not execute arbitrary code or calls |
| Policy-triggering analysis            | Require review regardless of model confidence or review suggestion          |

The pipeline must fail closed. Invalid or unavailable AI output is never converted into a normal trusted result.

## Sensitive-data rules

- Only synthetic case data and fixtures belong in this public repository.
- Raw report descriptions, provider payloads, secrets, and personal identifiers must not be logged.
- `subjectRef` is a synthetic pseudonymous lookup key, not a real identity.
- LLM keys belong only in ignored local environment files or secured CI secrets.
- Tool responses must contain the minimum metadata needed for triage.
- Trace records may contain IDs, model/prompt versions, latency, token counts, retry counts, and review reasons, but not raw case narratives.

## Change-control rule

A change to any schema, review reason, confidence threshold, retry limit, tool permission, or invariant requires:

1. a code reviewable diff;
2. deterministic tests for the changed behavior;
3. updated documentation;
4. evaluation updates when model behavior is affected;
5. explicit acknowledgement if the change broadens model authority or data access.

No prompt change may weaken an application-level invariant.
