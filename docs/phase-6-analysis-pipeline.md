# Phase 6: Validated Analysis Pipeline

## Objective

Phase 6 introduces the application service that converts a validated `CaseInput` into a trusted, typed `CaseAnalysis`.

```text
CaseInput
   |
   v
versioned triage request
   |
   v
provider-neutral LLMClient
   |
   v
untrusted normalized result
   |
   v
application-owned Zod validation
   |
   +--> typed CaseAnalysis + trace metadata
   |
   +--> MODEL_OUTPUT_INVALID
```

The service deliberately validates output even though provider adapters also request or validate structured output. Provider-side guarantees are useful, but the application remains the final trust boundary.

## Service contract

`AnalysisService.analyze(caseInput)` returns an `AnalysisExecution` containing:

- a typed `CaseAnalysis` with no `any` or provider SDK types;
- the configured model reported by the normalized client result;
- the `triage-v1` prompt version;
- a normalized provider response ID for operational correlation;
- measured model-call latency in whole milliseconds;
- token usage when the provider supplies it.

The service never returns the raw model payload. Provider SDK objects remain inside their adapters, so replacing OpenAI, Gemini, Groq, or a fake client does not change the service's domain result.

## Invalid output

Malformed output raises `AnalysisOutputValidationError` with the stable code `MODEL_OUTPUT_INVALID`. Its issues contain only schema codes and property paths; they do not include rejected values, report text, provider payloads, or tool arguments.

An unexpected tool request is also rejected at this boundary. Tool execution is not part of Phase 6 and no requested operation is run implicitly.

Normalized `LLMClientError` instances pass through unchanged to the Phase 7 reliability service, which applies one bounded retry and a fail-closed fallback.

## Verification

The database-independent unit tests cover:

- valid output becoming typed analysis with model, prompt, latency, and usage metadata;
- strict rejection of malformed output and unknown fields;
- sanitized rejection of an unexpected tool request;
- preservation of normalized provider errors for the retry layer.

Run them with the normal offline quality gate:

```bash
npm test
npm run typecheck
```

No API key or live model call is required.

The optional live smoke command sends one fixed synthetic report through both the configured provider adapter and this application validation service. It prints only bounded trace metadata, not the report or model analysis:

```bash
npm run llm:smoke
```

## Deferred work

WBS 5.3 and 5.4 remain open. Successful analysis persistence depends on the deterministic human-review policy from WBS 7, because the analysis and the application-owned routing decision must be stored together. The external model call will remain outside the later database transaction.

The analyze HTTP endpoint also remains deferred until validation, review policy, persistence, and fallback behavior form a complete fail-closed workflow.

The complete evaluation command remains deferred as well. Its WBS 11 contract requires the baseline golden dataset, deterministic review policy, metrics, and regression thresholds; advertising a partial evaluator before those dependencies exist would give a misleading result.
