# Phase 11: Golden Evaluation Dataset

## Objective

Phase 11 creates a versioned, runtime-validated set of synthetic cases for measuring the triage system. Expectations are committed before running the live evaluator so failures are visible and are not silently converted into new “correct” answers after observing a model.

The dataset version is `golden-v1`. Its loader calculates a SHA-256 identity from the sorted fixture filenames and exact file contents. Evaluation reports can therefore identify both the human-readable version and the precise dataset revision.

## Distribution

The dataset contains 30 cases:

| Category       |  Cases |
| -------------- | -----: |
| Safeguarding   |      5 |
| Harassment     |      5 |
| Discrimination |      5 |
| Financial      |      5 |
| Privacy        |      5 |
| Other          |      5 |
| **Total**      | **30** |

Low, medium, and high severity expectations are represented. When a case is legitimately ambiguous, `expected.category` or `expected.severity` contains an explicit `oneOf` set. The evaluator must match one of those predeclared values; it may not add an acceptable answer after execution.

The dataset is deliberately safety-focused rather than statistically representative of real case traffic. Twenty-nine cases require human review and carry the `critical-review` tag. `OTHER-001` is an irrelevant-content negative control expected not to require review. These proportions make critical-review recall visible but must not be interpreted as production prevalence.

## Difficult and adversarial coverage

Committed tags demonstrate coverage for every required class:

- `insufficient-information`;
- `conflicting-details`;
- `ambiguous-category`;
- `prompt-injection`;
- `irrelevant-content`;
- `long-input` (bounded by the production input schema);
- `confidence-policy` (safeguarding still requires review regardless of confidence);
- `missing-information` (deterministic review reason).

The prompt-injection text is part of the synthetic report and is expected to be treated as untrusted data. It cannot alter the system task, output schema, classification expectations, or deterministic application policy.

## Runtime invariants

Every fixture is validated before evaluation begins:

- stable ID format and uniqueness across every fixture file;
- production `CaseInput` validation;
- valid exact or explicit ambiguous category/severity expectations;
- valid, unique required review reasons;
- unique normalized tags;
- `critical-review` present exactly when `expected.reviewRequired` is true.

Invalid JSON identifies its source file. Schema failures include the source, fixture ID where available, and failing field path. Duplicate IDs across files identify both sources.

## Data boundary

All descriptions, reporter types, and subject references are synthetic. Fixtures contain no real allegations, identities, contact details, or provider output. The dataset must not be replaced with production case data.

## Verification

The dataset tests verify:

- all 30 files entries parse through runtime schemas;
- IDs are globally unique;
- each category has five cases;
- all severity values are represented;
- all difficult/adversarial tags are present;
- the long input remains inside the production limit;
- the critical-review subset exactly matches expected review-required cases.

```bash
npm test -- --run tests/unit/evaluation-fixture.schema.test.ts tests/unit/evaluation-dataset.test.ts
```
