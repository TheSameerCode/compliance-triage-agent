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

The status column distinguishes controls already enforced from planned controls whose implementation depends on later WBS tasks.

| ID     | Invariant                                                                             | Status                                                   | Implementation location                                                                         | Test evidence or planned test                                                                                                   |
| ------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| INV-01 | No LLM response is consumed before local schema validation.                           | Contract enforced; service integration planned           | `src/domain/analysis.schemas.ts`; parsing service in WBS 5.1                                    | Existing `tests/unit/analysis.schemas.test.ts`; WBS 12.5 will test malformed provider output through the service                |
| INV-02 | Safeguarding cases always require human review.                                       | Planned                                                  | `src/domain/review-policy.ts` in WBS 7.1                                                        | WBS 12.3 policy test: safeguarding plus high confidence still requires review                                                   |
| INV-03 | High-severity cases always require human review.                                      | Planned                                                  | `src/domain/review-policy.ts` in WBS 7.1                                                        | WBS 12.3 policy test: high severity cannot be bypassed by model confidence or suggestion                                        |
| INV-04 | Low-confidence cases always require human review.                                     | Configuration contract enforced; policy planned          | Threshold in `src/config/env.ts`; policy in WBS 7.1                                             | Existing environment-bound tests; WBS 12.3 boundary tests below, at, and above the configured threshold                         |
| INV-05 | Cases with material missing information require human review.                         | Planned                                                  | `src/domain/review-policy.ts` in WBS 7.1                                                        | WBS 12.3 policy tests for empty and non-empty `missingInformation` arrays                                                       |
| INV-06 | Repeated malformed model output produces a fallback requiring human review.           | Fallback contract enforced; retry flow planned           | `src/domain/decision.schemas.ts`; retry/fallback service in WBS 6.2–6.3                         | Existing fallback schema tests; WBS 12.5 invalid-then-invalid fake-client test                                                  |
| INV-07 | Provider failure produces human review or an explicit failed/fallback analysis state. | Fallback contract enforced; provider handling planned    | `src/domain/decision.schemas.ts`; normalized provider errors in WBS 6.1 and fallback in WBS 6.4 | Existing `MODEL_CALL_FAILED` contract; WBS 12.5 provider-error test                                                             |
| INV-08 | The model cannot close or resolve a case.                                             | Domain boundary enforced; persistence/API review planned | Model schema exposes analysis only; persistence models in WBS 2 and service in WBS 5            | Existing strict-schema test rejects application-owned fields; WBS 12.6 API tests will verify no close/resolve model path exists |
| INV-09 | The model cannot make guilt, legal, disciplinary, or employment decisions.            | Domain boundary enforced; prompt/eval coverage planned   | `src/domain/analysis.schemas.ts`; prompt in WBS 4.3; adversarial fixtures in WBS 10.3           | Existing strict enum/output tests; WBS 10.3 adversarial fixtures and WBS 11 evaluation assertions                               |
| INV-10 | Model tool access is explicit, read-only, allow-listed, and bounded.                  | Planned                                                  | Tool contract and registry in WBS 8.1–8.4                                                       | WBS 8 tests: unknown tool rejected, parameters validated, no write tools, maximum one tool round                                |

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

These schemas define valid states. WBS 7 implements the deterministic function that chooses those states.

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
