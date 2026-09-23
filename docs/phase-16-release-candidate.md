# Phase 16: Release-Candidate QA

## Scope

This audit was performed on 23 September 2026 before creating the `v0.1.0` interview-project tag. It covers the clean-clone path, deterministic quality suite, PostgreSQL integration, documented API flow, repository history/privacy, reliability invariants, reviewer navigation, and a separate live-model evaluation.

The release decision applies to the deterministic application and documentation. It does not turn the repository into a production compliance system or certify the current model/provider configuration.

## Clean-clone evidence

A new clone was created in an unrelated temporary directory from only tracked `main` content. No original `node_modules`, generated Prisma client, compiled output, `.env`, database, or untracked file was reused.

The audit followed the README sequence:

1. `npm ci` installed the lockfile and generated Prisma Client;
2. `.env.example` was copied to an ignored `.env` without live credentials;
3. `docker compose up --build --wait` built the migration/runtime images;
4. PostgreSQL became healthy and all three committed migrations ran;
5. the API became healthy and ready;
6. the documented synthetic create, analyze-without-credentials, retrieve, and review-queue contracts were exercised;
7. offline tests, PostgreSQL integration tests, build, and Prisma validation ran from the clone.

Observed API results:

| Check                           | Result                       |
| ------------------------------- | ---------------------------- |
| `GET /health`                   | `200 {"status":"ok"}`        |
| `GET /ready`                    | `200 {"status":"ready"}`     |
| `POST /api/cases`               | `201`, case status `NEW`     |
| Analyze without LLM credentials | `503 ANALYSIS_UNAVAILABLE`   |
| Retrieve newly created case     | matching ID, zero runs       |
| Empty required-review queue     | `200`, empty minimized array |
| Host `prisma migrate deploy`    | no pending migration         |
| PostgreSQL integration suite    | 10/10 tests passed           |

The first fresh clone exposed two documentation/platform defects:

- the Bash JSON `curl` example was not valid native PowerShell syntax;
- Git for Windows converted files to CRLF, causing Prettier's LF check to fail.

The README now labels Bash snippets and supplies a complete native PowerShell flow. `.gitattributes` now enforces LF for repository text while preserving CRLF for Windows batch files. Both findings were treated as release blockers and rechecked from a new clone.

## Deterministic quality result

The release-candidate suite is provider-independent:

| Command                        | Result                      |
| ------------------------------ | --------------------------- |
| `npm ci`                       | passed; zero audit findings |
| `npm run format:check`         | passed                      |
| `npm run typecheck`            | passed                      |
| `npm run lint`                 | passed                      |
| `npm test`                     | 146/146 tests passed        |
| `npm run test:integration`     | 10/10 tests passed          |
| `npm run build`                | passed                      |
| `npm run db:validate`          | passed                      |
| `npm audit --audit-level=high` | zero vulnerabilities        |

Normal CI repeats the relevant checks on Linux with an isolated PostgreSQL service and without LLM credentials.

## Security and privacy sweep

The sweep covered all tracked files and all 52 Git revisions present at audit time.

| Check                                            | Result                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| Known OpenAI/Groq/Google/GitHub/AWS key patterns | zero matches across Git history                                       |
| Private-key headers                              | zero matches across Git history                                       |
| Tracked `.env`                                   | never committed                                                       |
| Tracked environment files                        | `.env.example` only                                                   |
| npm dependency audit                             | zero vulnerabilities                                                  |
| Email-like values                                | one synthetic `example.test` database URL in a redaction test         |
| Database credentials                             | explicit local/CI test defaults only; no deployment credential        |
| Raw report/prompt/provider/tool logging          | excluded by call sites and Pino defense-in-depth redaction            |
| Public API internal errors                       | stable sanitized codes/messages; causes and stacks not serialized     |
| Evaluation artifacts                             | narratives, prompts, raw provider output, response IDs, keys excluded |

This pattern search is an engineering control, not a replacement for an organizational secret scanner, data inventory, threat model, or legal/data-protection review.

## Reliability review

| Required invariant                                        | Implementation evidence                                                                             | Test evidence                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Invalid model output cannot reach policy unvalidated      | `AnalysisService` parses `rawOutput` with `caseAnalysisSchema`; policy sees only validated analysis | analysis schema/service tests; malformed-output reliability tests                              |
| Retry count is bounded                                    | `ReliableAnalysisService` accepts only `0` or `1`; environment schema also caps at `1`              | constructor, retry, exhausted-output, and disabled-retry tests                                 |
| Provider failure routes safely                            | normalized model failures become `analysis: null` plus mandatory review                             | timeout/permanent provider tests and persisted fallback API/PostgreSQL test                    |
| Safeguarding/high severity override confidence            | deterministic review policy independently appends both reasons                                      | policy test proves high confidence and false model suggestion cannot bypass either rule        |
| Unknown tools cannot execute                              | registry lookup rejects names not in the constructed allow-list                                     | tool-registry unknown-name test                                                                |
| Tool output is minimal/read-only                          | strict output is count, distinct categories, and open-review flag from read-only queries            | tool schema/repository/integration tests verify no narratives and current-case exclusion       |
| Review reasons are persisted                              | analysis run and parent status update occur in one Prisma transaction                               | triage persistence and PostgreSQL atomic-routing tests                                         |
| Live evaluation is separate from unit tests and normal CI | separate `npm run eval` and manual secret-bearing workflow                                          | offline suite uses fakes; CI workflow has no provider secret; manual workflow is dispatch-only |

No reliability invariant failed. The live provider rejection described below followed the required safe route.

## Live-model evaluation

The live run was intentionally separate from deterministic QA:

- provider/model: Groq / `openai/gpt-oss-20b`;
- prompt: `triage-v1`;
- dataset: `golden-v1`, hash `8c637e27f19ace0f314cfd8164d3a7f61c11c96b910e97becec8754ff1239643`;
- fixtures: 30 synthetic cases;
- request pacing: 9 seconds.

| Metric                     | Result        |
| -------------------------- | ------------- |
| Schema-valid response rate | 29/30 (96.7%) |
| Category accuracy          | 29/30 (96.7%) |
| Severity accuracy          | 25/30 (83.3%) |
| Review-required accuracy   | 30/30 (100%)  |
| Critical-review recall     | 29/29 (100%)  |
| Average retries            | 0.000         |
| Token usage                | 32,510 total  |

The schema-validity gate failed because the provider rejected adversarial fixture `ADV-001`. The normalized result was `PROVIDER_REJECTED`; the application returned no analysis and forced review with `MODEL_CALL_FAILED`. The remaining three gates passed. Four additional fixtures had severity-label mismatches.

This failure is retained as evidence of provider variability and correct fail-closed behavior. It is not relabeled as a passing model result and does not weaken the 100% schema-validity threshold. The prior 22 September run of the same model/dataset passed all four gates, which reinforces that one passing sample is not a production guarantee.

## Five-minute reviewer sweep

The public default-branch README was fetched through the GitHub repository interface and checked against the nine WBS questions:

| Reviewer question                   | README location                                |
| ----------------------------------- | ---------------------------------------------- |
| What does it do?                    | opening overview                               |
| Why use an LLM?                     | “Why this project”                             |
| What happens when the LLM is wrong? | explicit failure-flow diagram                  |
| How is output evaluated?            | evaluation methodology and latest result       |
| Where is human control enforced?    | human-in-the-loop policy                       |
| What is the stack/architecture?     | first screen and architecture diagram          |
| How is it run?                      | local and Docker setup                         |
| Where are tests?                    | tests, evaluation, CI, and documentation links |
| What are the limitations?           | explicit limitations and future improvements   |

All local Markdown links resolve. The first screen exposes the core stack and reliability story without source-code archaeology. A visual in-app browser was unavailable during the audit, so the check used the public GitHub file surface plus link validation and does not claim screenshot-level visual QA.

## Release decision

The deterministic application, database path, Docker startup, documentation, privacy sweep, and reliability invariants satisfy the WBS 16 P0 acceptance criteria. `v0.1.0` is an interview-project release candidate, not a production release.

The failed current live-model schema gate is an explicit known result. Any deployment using this model/provider would remain blocked pending domain review, representative data, repeated evaluation, security/legal/data-protection controls, and an operational decision about provider rejection behavior.
