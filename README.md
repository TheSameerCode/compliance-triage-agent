# Compliance Triage Agent

A production-oriented LLM compliance triage demo focused on validated structured output, deterministic safeguards, and human review.

> Work in progress: the project is being implemented from the included work breakdown structure.

The current HTTP slice stores and retrieves synthetic cases without invoking an LLM. Provider-isolated OpenAI, Gemini, and Groq adapters plus a versioned triage prompt are available for the upcoming analysis pipeline.

## LLM reliability layer

- Application code depends on a local `LLMClient` contract rather than provider response objects.
- All provider adapters request structured output derived from the existing Zod analysis schema.
- Provider requests capture token usage and normalize failures into application error codes. OpenAI and Gemini requests also disable provider-side storage.
- Model refusals, incomplete output, malformed tool arguments, rate limits, authentication failures, timeouts, and provider outages are explicit outcomes.
- `triage-v1` treats report text as untrusted data and prohibits autonomous legal, disciplinary, guilt, or case-resolution decisions.

The adapters are deterministic-testable without network access. To run the optional live smoke check, set `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_API_KEY` locally, use a synthetic report only, and run:

```bash
npm run llm:smoke
```

The command prints only provider, model, prompt-version, result-type, and usage metadata—not the report or model output. Never commit or paste an API key into source, documentation, issues, or chat.

For Gemini, keep the key only in the ignored `.env` file:

```dotenv
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.7-flash
LLM_API_KEY=<your-key>
```

For Groq's free tier, create a Groq API key and use a model that supports strict structured output:

```dotenv
LLM_PROVIDER=groq
LLM_MODEL=openai/gpt-oss-20b
LLM_API_KEY=<your-groq-key>
```

Groq retention controls, including Zero Data Retention, are account settings rather than request parameters. Keep this demo synthetic regardless of provider configuration.

## HTTP API

| Method | Path             | Purpose                                                 |
| ------ | ---------------- | ------------------------------------------------------- |
| `GET`  | `/health`        | Process liveness                                        |
| `GET`  | `/ready`         | PostgreSQL readiness                                    |
| `POST` | `/api/cases`     | Validate and create a case without implicit AI analysis |
| `GET`  | `/api/cases/:id` | Retrieve case metadata and business analysis history    |

Requests and responses carry an `X-Request-Id`. JSON request bodies are limited to `32kb`, and errors use a stable `{ "error": { ... } }` envelope.

## Local development

Create `.env` from `.env.example`, configure a PostgreSQL database, and apply the committed migrations. A real LLM key is not required for the current API when `NODE_ENV=test`.

```bash
npm install
npm run db:deploy
npm run dev
```

Create a synthetic case:

```bash
curl -X POST http://localhost:3000/api/cases \
  -H "Content-Type: application/json" \
  -d '{"description":"A synthetic report containing enough detail for initial triage.","reporterType":"member","subjectRef":"subject_demo_10"}'
```

## Quality checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

The normal test suite is database-independent. With the migrated synthetic development database available through `DATABASE_URL`, run the separate PostgreSQL API tests with:

```bash
npm run test:integration
```

Integration tests remove only the exact synthetic records that they create.

## Privacy and limitations

This public demo has no authentication or authorization and must not be exposed as a production service or used with real reports. See [Privacy and Data Protection](docs/privacy.md) for the boundary between demo safeguards and production requirements.

## Implementation documentation

- [Phase 1: Engineering Foundation](docs/phase-1-engineering-foundation.md)
- [Reliability and Safety Invariants](docs/reliability.md)
- [Privacy and Data Protection](docs/privacy.md)
- [Phase 5: Provider-Isolated LLM Layer](docs/phase-5-llm-layer.md)
