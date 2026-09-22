# Phase 10: Observability and Privacy-Aware Tracing

## Objective

Phase 10 makes an analysis operationally explainable without recording the report narrative, prompts, provider payloads, tool arguments/results, or hidden model reasoning. Request-scoped logs support live diagnosis, while the append-only analysis row records the bounded configuration and execution metadata needed for later audit and regression work.

```text
X-Request-Id
     |
     v
request-scoped logger
     |
     +--> success/fallback event (allow-listed metadata)
     +--> hard-failure event (case ID + sanitized error code)
     |
     v
atomic analysis persistence
     +--> model + prompt version
     +--> retry count + total latency
     +--> token counts when supplied
     +--> allow-listed tool names only
     +--> nullable estimated cost (never invented)
```

## Persisted trace contract

Every completed or fallback `AnalysisRun` is associated with:

- configured or responding model name;
- versioned prompt identifier;
- bounded retry count;
- total application analysis latency;
- input/output token counts when the provider supplied usable metadata;
- distinct tool invocation names, including a tool used before a model retry;
- nullable estimated cost.

The `toolNames` migration uses a non-null PostgreSQL text array with an empty-array default. Existing rows therefore remain valid and explicitly mean “no recorded tool invocation.” Only registry-approved names reach the production analysis path.

Cost remains `null` because the current providers do not return a reliable per-request monetary cost and pricing varies by account and time. The application does not fabricate a number from stale pricing assumptions.

Fallback behavior is explicit:

- malformed structured output retains the last safe trace metadata and records schema validity as `invalid` in the operational event;
- provider failures retain the configured model/prompt, total latency, retry count, and any tool name already invoked, while unavailable token data remains null;
- tool, database, and programming failures do not create a misleading analysis row.

Provider response IDs are intentionally not persisted in the public demonstration. They remain bounded in-memory diagnostic metadata during execution and never enter public API responses.

## Structured events

All HTTP logs are JSON and inherit the request ID from the request-scoped child logger.

`case.analyzed` includes only:

- request, case, and analysis-run IDs;
- model and prompt version;
- total latency and retry count;
- schema validity (`valid`, `invalid`, or `unavailable`);
- invoked tool names;
- analysis status and review-required flag;
- a sanitized error code for a persisted fallback.

`case.analysis_failed` includes the request ID, case ID, and sanitized application error code. The generic HTTP error event records the status code and same bounded error code. Neither event logs the thrown error object or its cause.

The logger also applies defense-in-depth redaction to descriptions, case inputs, prompts, provider responses, tool arguments/results, authorization data, cookies, and API keys. Application call sites still use allow-listed fields; redaction is not treated as permission to log broad objects.

## API and privacy boundary

Operational observability metadata is carried internally from the triage service to the route and removed before serialization. Public analyze and retrieval responses continue to omit model names, prompt versions, latency, token/cost data, provider response IDs, and tool names.

The database still contains synthetic case descriptions because persistence is part of the demonstration. Trace minimization does not make this demo suitable for real compliance data. The controls and limitations in [Privacy and Data Protection](privacy.md) still apply.

## Verification

Automated coverage checks:

- completed, invalid-output fallback, and provider fallback trace construction;
- tool-name retention across a model retry;
- success/fallback/hard-failure structured event fields;
- request ID propagation into analysis events;
- absence of summaries, indicators, underlying error causes, and sensitive marker values from logs;
- logger redaction for descriptions, prompts, provider objects, tool payloads, and API keys;
- direct PostgreSQL verification of completed and fallback trace fields;
- continued omission of internal trace fields from public API responses;
- migration validity and rollback-safe atomic persistence behavior.

Run:

```bash
npm test
npm run db:deploy
npm run test:integration
```

No model key is required for these automated checks.
