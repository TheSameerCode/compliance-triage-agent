# WBS 13 — Dockerized Runtime

WBS 13 packages the compiled API and PostgreSQL into a reproducible local-review stack. A reviewer can start health, case-management, retrieval, and review-queue functionality without supplying an LLM key. Live analysis remains an explicit optional capability.

## Image design

The multi-stage `Dockerfile` has separate responsibilities:

1. `base` pins Node 24.19 on Debian Bookworm Slim and installs the OpenSSL/CA runtime required by Prisma and provider HTTPS calls;
2. `dependencies` uses `npm ci` and the committed lockfile;
3. `build` compiles TypeScript;
4. `production-dependencies` removes development packages;
5. `migrate` retains the Prisma CLI only for the one-shot deployment migration job; and
6. `runtime` contains compiled JavaScript and production dependencies only.

The API image runs as the unprivileged `node` user. Compose additionally makes its filesystem read-only, provides an ephemeral `/tmp`, drops Linux capabilities, and enables `no-new-privileges`. The `.dockerignore` excludes Git data, local environment files, tests, coverage, build output, evaluation results, and documentation from the build context. API keys are runtime environment values and are never Docker build arguments or image environment defaults.

## Compose lifecycle

```text
PostgreSQL starts
      |
      v
database health check passes
      |
      v
prisma migrate deploy exits successfully
      |
      v
compiled API starts and /ready becomes healthy
```

The stack contains:

- `db`: PostgreSQL 17 with `pg_isready` health checking and a named data volume;
- `migrate`: one-shot execution of all committed Prisma migrations; and
- `api`: the production image, exposed on host port `3000` by default.

Although `migrate` is represented as a Compose service, it is an initialization job rather than a long-running process. The API depends on its successful completion. A failed migration therefore blocks startup instead of running the application against an unknown schema.

## Startup

From a clean checkout:

```bash
cp .env.example .env
docker compose up --build --wait
curl http://localhost:3000/health
```

Expected health response:

```json
{ "status": "ok" }
```

No LLM key is necessary for health, readiness, case creation, case retrieval, or the review queue. When `LLM_MODEL` and `LLM_API_KEY` are both blank, `POST /api/cases/:id/analyze` returns a controlled `503 ANALYSIS_UNAVAILABLE`. Supplying only one of those settings is rejected during configuration validation.

To enable live analysis, set all three values in the ignored `.env` file before starting Compose:

```dotenv
LLM_PROVIDER=groq
LLM_MODEL=openai/gpt-oss-20b
LLM_API_KEY=<set-locally>
```

Never commit the populated file.

## Ports and storage

- `API_PORT` maps to container port `3000` and defaults to host port `3000`.
- `POSTGRES_PORT` maps to container port `5432` and defaults to host port `5433`, avoiding the common local PostgreSQL port.
- `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` have synthetic-development defaults and can be overridden.
- the Compose-managed `postgres_data` volume persists database state across ordinary stops and rebuilds.

Use `docker compose down` to stop the stack without removing data. The destructive local-reset command `docker compose down --volumes` removes the Compose-owned database volume; it is not part of normal startup or migration behavior.

## Migration workflow

Startup uses only:

```bash
prisma migrate deploy
```

This command applies committed migrations and is safe to rerun when none are pending. It does not generate new migrations, reset the database, or invoke development migration behavior. To apply new committed migrations to an existing Compose database:

```bash
docker compose run --rm migrate
```

For a host-managed PostgreSQL database, the equivalent command is:

```bash
npm run db:deploy
```

Creating schema changes remains a deliberate development activity through `npm run db:migrate`; it is never performed automatically by the container runtime.

## Verification performed

The stack was built and tested from a fresh isolated Compose project with blank LLM settings:

- production and migration targets built successfully;
- Prisma detected OpenSSL without warnings;
- PostgreSQL reached healthy status;
- all three committed migrations applied to an empty named volume;
- rerunning the migration job reported no pending migrations;
- the API ran as user `node` and reached healthy status;
- `/health` and `/ready` returned `200`;
- a synthetic case was created with `201` and retrieved with `200`;
- the keyless analysis route returned the expected controlled `503`; and
- image configuration contained no LLM model or API key.

These checks validate the local reviewer workflow. They do not make the Compose development defaults suitable for an internet-exposed production deployment.
