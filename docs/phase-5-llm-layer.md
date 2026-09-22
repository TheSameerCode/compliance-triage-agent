# Phase 5: Provider-Isolated LLM Layer

## Objective

Phase 5 introduces the model boundary without connecting it to the HTTP case workflow yet. The rest of the application depends on a provider-neutral `LLMClient`, while OpenAI SDK calls remain isolated in one adapter.

```text
CaseInput + triage-v1
        |
        v
provider-neutral LLMClient
        |
        v
OpenAI Responses API adapter
        |
        +--> structured analysis candidate
        +--> bounded tool request
        +--> normalized application error
```

The upcoming analysis service remains responsible for treating the returned analysis candidate as untrusted and validating it at the application boundary before business policy or persistence uses it.

## Contracts and safeguards

- `LLMClient` exposes the configured model, structured-analysis requests, optional read-only tool definitions, usage metadata, and provider-neutral results.
- Tool requests are data only. This layer does not execute tools or create an autonomous loop.
- The OpenAI adapter uses the Responses API structured-output helper with the application-owned Zod schema.
- Requests set `store: false`, disable parallel tool calls, and cap output at 1,200 tokens.
- Raw case descriptions, complete prompts, provider responses, and API keys are never logged.
- Refusals and incomplete results cannot be mistaken for valid analyses.

Normalized errors deliberately use generic messages:

| Code                        | Retryable |
| --------------------------- | --------- |
| `TIMEOUT`                   | Yes       |
| `RATE_LIMITED`              | Yes       |
| `PROVIDER_UNAVAILABLE`      | Yes       |
| `INCOMPLETE_RESPONSE`       | Yes       |
| `AUTHENTICATION_FAILED`     | No        |
| `PROVIDER_REJECTED`         | No        |
| `MODEL_REFUSAL`             | No        |
| `INVALID_PROVIDER_RESPONSE` | No        |

Retry policy is not implemented in this layer; the later WBS 6 reliability phase will own the single allowed retry and safe fallback.

## Prompt versioning

`triage-v1` is exported as a constant beside the prompt text. It tells the model to assist a human reviewer, summarize neutrally, expose missing information, obey the schema, treat report text as untrusted data, and avoid final decisions. The database already requires a prompt version on every analysis run.

The adversarial fixture `ADV-001` embeds an instruction in a synthetic report that attempts to override category, severity, and review routing. It is schema-validated now and will run against a live model when the evaluation runner is implemented.

## Verification

Normal tests use a fake `LLMClient` and a mocked HTTP transport, so they do not require network access or an API key. The optional live check uses only a fixed synthetic report:

```bash
npm run llm:smoke
```

Configure `LLM_MODEL` and `LLM_API_KEY` only in the ignored local `.env` file. The smoke command emits metadata but not the input narrative or structured model output.
