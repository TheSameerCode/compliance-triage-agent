# Compliance Triage Agent

[![CI](https://github.com/TheSameerCode/compliance-triage-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/TheSameerCode/compliance-triage-agent/actions/workflows/ci.yml)

A production-oriented LLM compliance triage demo focused on validated structured output, deterministic safeguards, and human review.

> Work in progress: the project is being implemented from the included work breakdown structure.

The HTTP API stores synthetic cases and can explicitly analyze a stored case through the configured OpenAI, Gemini, or Groq adapter. Model output is locally validated, retried at most once when appropriate, routed by deterministic application policy, and persisted atomically with the parent case status.

## LLM reliability layer

- Application code depends on a local `LLMClient` contract rather than provider response objects.
- All provider adapters request structured output derived from the existing Zod analysis schema.
- The analysis service revalidates every normalized provider result and never returns raw model output.
- Successful service results include only typed analysis and bounded trace metadata such as model, prompt version, latency, response ID, and optional token usage.
- Provider requests capture token usage and normalize failures into application error codes. OpenAI and Gemini requests also disable provider-side storage.
- Model refusals, incomplete output, malformed tool arguments, rate limits, authentication failures, timeouts, and provider outages are explicit outcomes.
- Retryable model failures receive at most one iterative retry; permanent failures are not retried.
- Exhausted model failures produce an explicit fallback with no fabricated analysis and mandatory human review.
- Database and tool failures are normalized separately and are never blindly retried as model calls.
- The only MVP tool is a read-only, allow-listed prior-case metadata lookup; it returns no narratives and is limited to one tool round across retries.
- Completed and fallback runs persist bounded trace metadata, while request-scoped JSON logs expose only operational fields and sanitized error codes.
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

| Method | Path                           | Purpose                                                  |
| ------ | ------------------------------ | -------------------------------------------------------- |
| `GET`  | `/health`                      | Process liveness                                         |
| `GET`  | `/ready`                       | PostgreSQL readiness                                     |
| `POST` | `/api/cases`                   | Validate and create a case without implicit AI analysis  |
| `POST` | `/api/cases/:id/analyze`       | Analyze, route, and persist one immutable run            |
| `GET`  | `/api/cases/:id`               | Retrieve case metadata and business analysis history     |
| `GET`  | `/api/reviews?status=required` | List minimized metadata for cases requiring human review |

Requests and responses carry an `X-Request-Id`. JSON request bodies are limited to `32kb`, and errors use a stable `{ "error": { ... } }` envelope.

## Local development

Create `.env` from `.env.example`, configure a PostgreSQL database, and apply the committed migrations. The case-management, health, and review APIs can start without LLM credentials. Set both `LLM_MODEL` and `LLM_API_KEY` only when enabling live analysis; otherwise the analysis endpoint returns `503 ANALYSIS_UNAVAILABLE`.

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

Request analysis explicitly, replacing the example ID with the returned case ID:

```bash
curl -X POST http://localhost:3000/api/cases/<case-id>/analyze
```

This endpoint invokes the configured model and may consume provider quota. Use synthetic reports only.

## Docker startup

The Compose stack starts PostgreSQL, applies the committed migrations through a one-shot `migrate` service, and then starts the compiled API. Live analysis credentials are optional for health checks and case management.

```bash
cp .env.example .env
docker compose up --build --wait
curl http://localhost:3000/health
```

Create a synthetic case after the stack is healthy:

```bash
curl -X POST http://localhost:3000/api/cases \
  -H "Content-Type: application/json" \
  -d '{"description":"A synthetic container verification report with sufficient detail.","reporterType":"reviewer","subjectRef":"subject_docker_demo"}'
```

Container resources:

| Resource                 | Default                                      | Override                              |
| ------------------------ | -------------------------------------------- | ------------------------------------- |
| API port                 | `3000`                                       | `API_PORT`                            |
| PostgreSQL host port     | `5433`                                       | `POSTGRES_PORT`                       |
| PostgreSQL database      | `compliance_agent`                           | `POSTGRES_DB`                         |
| PostgreSQL user/password | `postgres` / `postgres` development defaults | `POSTGRES_USER` / `POSTGRES_PASSWORD` |
| Database storage         | named volume `postgres_data`                 | managed by Compose                    |

Compose runs `prisma migrate deploy`, never the development-oriented `migrate dev`, before allowing the API to start. Reapply pending committed migrations explicitly with:

```bash
docker compose run --rm migrate
```

Stop containers while retaining database data with `docker compose down`. `docker compose down --volumes` also deletes the Compose PostgreSQL volume and should only be used when an intentional local reset is wanted.

## Quality checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
```

The normal test suite and coverage report are database-independent and never call a live model. Coverage is reported for API, domain, and service code to expose untested safety-critical paths; it is not presented as proof of system safety. With the migrated synthetic development database available through `DATABASE_URL`, run the separate PostgreSQL API tests with:

```bash
npm run test:integration
```

Integration tests remove only the exact synthetic records that they create.

## Continuous integration

The `CI` GitHub Actions workflow runs on every push to `main` and every pull request. It installs only the committed dependency graph with `npm ci`, then runs formatting, typechecking, linting, deterministic tests, committed migrations, PostgreSQL integration tests, the production build, and Prisma validation. PostgreSQL runs as an isolated service container, and normal CI receives no LLM secret or live-model access.

Live model evaluation is deliberately separate. To enable the manual workflow:

1. create a repository Actions secret named `LLM_API_KEY` containing the key for the provider you intend to select;
2. open **Actions → Live model evaluation → Run workflow**;
3. run it from `main`, select the provider and model, and choose the request interval appropriate for the account limits.

The manual job runs `npm run eval`, fails when a committed regression gate fails, and retains `evals/results/latest.json` as a 14-day workflow artifact. It is never triggered by pull requests or ordinary pushes. The report remains a synthetic engineering evaluation, not a production-safety or legal-compliance claim.

Verify the committed prior-case seed through the read-only tool contract:

```bash
npm run db:seed
npm run tool:smoke
```

## Model evaluation

Run the 30-case synthetic golden dataset against the configured provider:

```bash
npm run eval
```

The live command consumes provider quota and returns non-zero when a committed regression gate fails. Groq evaluations default to a 9-second interval; `EVAL_REQUEST_INTERVAL_MS` in the ignored `.env` file can override provider pacing. Generated reports are written to `evals/results/latest.json` and excluded from git.

Compare two reports produced from the same dataset:

```bash
npm run eval:compare -- path/to/baseline.json path/to/candidate.json
```

The synthetic regression gates are engineering checks, not production safety or compliance guarantees.

## Privacy and limitations

This public demo has no authentication or authorization and must not be exposed as a production service or used with real reports. See [Privacy and Data Protection](docs/privacy.md) for the boundary between demo safeguards and production requirements.

## Implementation documentation

- [Phase 1: Engineering Foundation](docs/phase-1-engineering-foundation.md)
- [Reliability and Safety Invariants](docs/reliability.md)
- [Privacy and Data Protection](docs/privacy.md)
- [Phase 5: Provider-Isolated LLM Layer](docs/phase-5-llm-layer.md)
- [Phase 6: Validated Analysis Pipeline](docs/phase-6-analysis-pipeline.md)
- [Phase 7: Retry, Failure Handling, and Safe Fallback](docs/phase-7-retry-and-fallback.md)
- [Phase 8: Deterministic Human-Review Policy](docs/phase-8-human-review-policy.md)
- [Phase 9: Controlled Tool Calling](docs/phase-9-controlled-tool-calling.md)
- [Phase 10: Observability and Privacy-Aware Tracing](docs/phase-10-observability-and-tracing.md)
- [Phase 11: Golden Evaluation Dataset](docs/phase-11-golden-evaluation-dataset.md)
- [Phase 12: Evaluation Harness and Regression Gates](docs/phase-12-evaluation-harness.md)
- [Phase 13: Deterministic Automated Tests](docs/phase-13-automated-tests.md)
- [WBS 13: Dockerized Runtime](docs/wbs-13-dockerized-runtime.md)
- [WBS 14: CI and Evaluation Workflows](docs/wbs-14-ci-and-evaluation-workflows.md)
