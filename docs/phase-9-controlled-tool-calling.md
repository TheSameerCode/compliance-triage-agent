# Phase 9: Controlled Tool Calling

## Objective

Phase 9 adds one narrowly scoped, read-only database tool to the analysis workflow. Tool use is application-controlled: the model may request a lookup, but it cannot execute database operations itself, select an unregistered capability, retrieve case narratives, or start an autonomous chain.

```text
stored case input
      |
      v
model + allow-listed definition
      |
      +-- final analysis -------------------------+
      |                                           |
      +-- one get_previous_cases request          |
             |                                    |
             v                                    |
       validate name and arguments                |
             |                                    |
             v                                    |
       read minimized metadata                    |
             |                                    |
             v                                    |
       model continuation (tools disabled) -------+
                                                   |
                                                   v
                                      validated structured analysis
```

## Tool contract

The only registered MVP tool is `get_previous_cases`.

Input:

```json
{ "subjectRef": "subject_demo_01" }
```

Output:

```json
{
  "previousCaseCount": 2,
  "categories": ["harassment", "safeguarding"],
  "hasOpenReview": true
}
```

Strict Zod schemas validate both sides of the boundary. Unknown fields, invalid subject references, duplicate/invalid categories, and malformed repository output fail with the sanitized `TOOL_EXECUTION_FAILED` application error.

The requested `subjectRef` must exactly match the subject reference on the stored case. This prevents report text or a model-generated argument from querying another subject. Cases without a subject reference do not receive the tool definition.

## Registry and database boundary

`ToolRegistry` is an explicit allow list. Unknown names and duplicate registrations are rejected. The previous-case repository performs only aggregate/select operations and excludes the case currently being analyzed.

Only these values can cross the tool boundary:

- count of other cases with the same pseudonymous subject reference;
- distinct analysis categories, sorted for deterministic output;
- whether any matching case is currently routed to human review.

Descriptions, reporter types, summaries, indicators, missing information, model/provider payloads, and identifiers for earlier cases are never returned.

## Bounded execution

The application accepts exactly one tool call in a tool round. It executes the validated call and asks the provider for the final structured analysis with tools disabled. A second tool request, multiple calls in one response, an unknown tool, or cross-subject arguments produce a controlled failure.

`ToolRoundBudget` is shared across the reliability retry. If a provider failure or invalid final result triggers the single permitted retry, the consumed tool round is not restored. This keeps the entire analysis execution—not merely an individual provider attempt—bounded to one tool round.

OpenAI, Gemini, and Groq adapters translate the same provider-neutral continuation into their respective wire formats. Provider objects do not escape the adapter boundary.

## Trace and failure behavior

Successful internal analysis traces can include only the tool name and rounded execution latency. Tool arguments, tool results, subject references, and prior-case content are not included in the trace. Public case responses continue to omit internal trace data.

Tool and database failures are not treated as model failures and are not blindly retried. The HTTP layer returns a stable, sanitized error envelope without exposing the underlying database/provider cause. Persistence occurs only after a final validated analysis, so failed tool execution does not create a partial analysis run.

[Phase 10](phase-10-observability-and-tracing.md) persists allow-listed tool names and emits them in privacy-safe operational events without widening the public API. Tool arguments and results remain excluded.

## Verification

The automated tests cover:

- strict input and output validation;
- current-subject enforcement and current-case exclusion;
- unknown and duplicate registry entries;
- one complete request → tool → result → structured-analysis path;
- rejection of multiple and chained calls;
- one shared tool budget across model retries;
- provider continuation formats for OpenAI, Gemini, and Groq;
- sanitized HTTP tool failures;
- real PostgreSQL aggregation with deterministic categories and no narrative leakage.

Run the offline and PostgreSQL suites separately:

```bash
npm test
npm run test:integration
```

Only synthetic data is permitted. No API key is needed for either automated suite.

To verify the committed `subject_demo_01` seed through the real tool contract:

```bash
npm run db:seed
npm run tool:smoke
```

The expected minimized result is two prior cases, the sorted categories `harassment` and `safeguarding`, and an open-review flag. The command does not print case narratives.
