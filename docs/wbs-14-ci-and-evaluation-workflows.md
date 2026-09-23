# WBS 14 — CI and Evaluation Workflows

WBS 14 separates deterministic software verification from provider-dependent model evaluation. Pushes and pull requests must be testable without credentials, quota, network model calls, or probabilistic output. A real-model evaluation is an explicit, cost-aware manual operation.

## Deterministic CI

`.github/workflows/ci.yml` runs for every pull request and every push to `main`. It grants the workflow token read-only repository access and cancels stale runs for the same branch or pull request.

The job uses Node 24.19 and an isolated PostgreSQL 17 service container. Its ordered checks are:

```text
checkout with persisted credentials disabled
  -> npm ci
  -> format check
  -> typecheck
  -> lint
  -> deterministic unit/API tests
  -> prisma migrate deploy
  -> PostgreSQL integration tests
  -> production TypeScript build
  -> Prisma schema validation
```

The job defines `NODE_ENV=test` and a synthetic CI database URL. It does not define `LLM_API_KEY`, does not call a provider, and does not run `npm run eval`. The PostgreSQL container starts empty on every job, and all committed migrations run before integration tests, so state cannot leak between workflow runs.

## Manual live evaluation

`.github/workflows/live-evaluation.yml` is available only through `workflow_dispatch`. The evaluation job has an additional `main`-branch condition: selecting another Git ref does not start the secret-bearing job.

The operator chooses:

- `provider`: `groq`, `openai`, or `gemini`;
- `model`: the exact provider model identifier; and
- `request_interval_ms`: pacing between golden-fixture requests.

The API key is read only from `${{ secrets.LLM_API_KEY }}`. It is not an input, command argument, artifact field, cache entry, repository file, or workflow log value. The workflow token has read-only contents permission, checkout does not persist credentials, and dependency caching is explicitly disabled in the secret-bearing job.

To configure it:

1. open the repository's **Settings → Secrets and variables → Actions** page;
2. create the repository secret `LLM_API_KEY`;
3. open **Actions → Live model evaluation**;
4. select **Run workflow**, keep the workflow ref on `main`, and enter matching provider/model settings.

Only repository users with permission to run manual workflows can start it. Provider usage may incur cost and rate limiting. Use only the committed synthetic fixtures.

## Regression and artifact behavior

The workflow executes the same `npm run eval` command documented for local use. The command writes a privacy-minimized report to `evals/results/latest.json` and exits non-zero when a committed regression gate fails.

The upload step uses `always()` and runs whenever the report exists. Therefore a gate failure remains a failed workflow while still preserving the evidence needed to diagnose it. Artifacts are named with the selected provider and immutable workflow run ID and retained for 14 days.

If configuration fails before a report is created—for example, because `LLM_API_KEY` is missing—no empty artifact is uploaded, and the workflow fails with a configuration message that does not reveal a secret value.

## Security boundaries

- normal push/PR CI has no provider secret;
- forked pull-request code cannot reach a model key because the live workflow is manual-only;
- the live job runs only for the reviewed `main` ref;
- dependency caching is disabled where the provider secret is present;
- official GitHub actions use current major releases;
- workflow permissions are limited to `contents: read`;
- generated reports contain fixture IDs, classifications, metrics, usage, latency, and sanitized failure codes—not fixture narratives or provider payloads.

GitHub branch protection is a repository setting rather than a committed file. For a production collaboration workflow, configure the `Quality and PostgreSQL integration` job as a required status check before merging.

## Local reproduction

The normal workflow can be reproduced with a migrated PostgreSQL database:

```bash
npm ci
npm run format:check
npm run typecheck
npm run lint
npm test
npm run db:deploy
npm run test:integration
npm run build
npm run db:validate
```

The live workflow is intentionally reproduced separately:

```bash
npm run eval
```

Do not add the live command to normal CI. Its variability, external dependency, latency, and potential cost are exactly why software tests and model evaluations remain separate workflows.
