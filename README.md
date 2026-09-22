# Compliance Triage Agent

A production-oriented LLM compliance triage demo focused on validated structured output, deterministic safeguards, and human review.

> Work in progress: the project is being implemented from the included work breakdown structure.

The current HTTP slice stores and retrieves synthetic cases without invoking an LLM. AI analysis will be added in a later phase.

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
