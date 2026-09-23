# Interview Demo Runbook

## Goal and timing

This is a **seven-minute, synthetic-data-only** walkthrough of the engineering decisions behind the Compliance Triage Agent. It shows a successful provider path, application-owned human-review routing, a malformed-output fallback, evaluation evidence, and CI without depending on a flawless live model response.

| Time      | Demo step                            | Job signal                                                        |
| --------- | ------------------------------------ | ----------------------------------------------------------------- |
| 0:00-0:40 | Problem and design boundary          | Product judgment for sensitive AI                                 |
| 0:40-1:20 | Architecture                         | TypeScript, APIs, PostgreSQL, provider isolation                  |
| 1:20-2:00 | Create a case                        | Explicit side effects, validation, stable contracts               |
| 2:00-3:00 | Analyze through a live provider      | Structured output, traces, real provider integration              |
| 3:00-4:00 | Force deterministic human review     | Application policy beats model preference                         |
| 4:00-4:50 | Inject repeated malformed output     | Bounded retry, fail-closed fallback, no fabricated result         |
| 4:50-5:50 | Evaluation report and regression     | Fixtures, metrics, operational constraints, honest interpretation |
| 5:50-6:30 | CI and Docker                        | Reproducible delivery and separation of deterministic/live checks |
| 6:30-7:00 | Limitations and next production step | Calibrated claims and ownership                                   |

## Prepare before the interview

Use only invented data. Do not show the `.env` file, terminal history containing a key, provider dashboards, or raw provider payloads on screen.

1. Pull the current `main` branch and install from the lockfile.
2. Put a working provider/model/key in the ignored `.env` file.
3. Start the Compose stack and confirm both probes.
4. Run the full test suite and PostgreSQL integration suite.
5. Run `npm run eval` in advance. A live 30-case Groq evaluation is intentionally paced and does not fit a seven-minute demo.
6. Open these tabs before presenting:
   - README architecture and failure-flow diagrams;
   - this runbook;
   - `src/domain/review-policy.ts`;
   - `src/services/reliable-analysis.service.ts`;
   - `evals/results/latest.json` if a fresh local result exists;
   - the repository Actions page.

```bash
npm ci
docker compose up --build --wait
curl http://localhost:3000/health
curl http://localhost:3000/ready
npm test
npm run test:integration
```

Expected probes:

```json
{"status":"ok"}
{"status":"ready"}
```

## 1. Frame the problem and boundary — 40 seconds

Say:

> The model is used for a bounded triage suggestion, not a final compliance decision. Its response is treated like untrusted external input: validate it, retry only within a fixed budget, apply deterministic policy, and send every sensitive or uncertain outcome to a human.

Point to the README opening and principles. Emphasize that the repository is an engineering demonstration using synthetic data, not a deployed compliance or GDPR-certified product.

**Job signal:** product-aware AI engineering where people, cases, and trust matter more than an impressive happy-path demo.

## 2. Explain the architecture — 40 seconds

Point to the README architecture diagram and follow one request:

1. Express validates input and assigns a request ID.
2. The explicit analysis endpoint loads the stored case.
3. `LLMClient` isolates OpenAI, Gemini, and Groq SDKs.
4. Local Zod validation and the reliability layer govern the model boundary.
5. Deterministic policy computes review routing.
6. Prisma writes the immutable run and parent status in one transaction.

Mention that request logs contain operational metadata, not report narratives or raw model responses.

**Job signal:** clear boundaries across API, model, domain policy, persistence, and observability.

## 3. Create a synthetic case — 40 seconds

Run:

```bash
curl -i -X POST http://localhost:3000/api/cases \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: interview-create" \
  -d '{"description":"A synthetic volunteer reports repeated unwanted messages after a club event.","reporterType":"volunteer","subjectRef":"subject_interview_demo"}'
```

Copy the returned `data.id` for the next command. Show the `201`, `Location`, `X-Request-Id`, and `NEW` status. State that creation never performs hidden AI work.

Optional quick contract failure if time allows:

```bash
curl -X POST http://localhost:3000/api/cases \
  -H "Content-Type: application/json" \
  -d '{"description":"too short","unexpected":true}'
```

**Job signal:** strict request contracts and explicit, reviewable side effects.

## 4. Analyze the case — 60 seconds

Replace `<case-id>` with the copied ID:

```bash
curl -X POST http://localhost:3000/api/cases/<case-id>/analyze \
  -H "X-Request-Id: interview-analyze"
```

Show these fields, without presenting the exact model text as a ground truth:

- `analysisStatus` is `completed` when local validation succeeds;
- `analysis` has the strict category/severity/summary shape;
- `reviewDecision` is produced by application policy;
- `retryCount` makes recovery visible;
- `caseStatus` reflects the persisted routing outcome.

Then retrieve the immutable history:

```bash
curl http://localhost:3000/api/cases/<case-id>
```

Point out that public retrieval omits token counts, provider response IDs, prompts, costs, and provider payloads.

If the live provider is rate-limited or unavailable, treat it as the planned failure scenario: show the sanitized outcome/log code, explain that quota is operational state rather than model quality, and continue with the deterministic demonstrations below. Do not swap keys or weaken safeguards during the interview.

**Job signal:** a real provider integration with structured output, explicit failure modes, and bounded public data.

## 5. Prove forced human review — 60 seconds

A live model is not a reliable way to stage an exact severity or category. Use the integration test that calls the HTTP analysis endpoint with a deterministic fake model and a real PostgreSQL repository:

```bash
npm run test:integration -- -t "persists policy reasons and case routing atomically"
```

Explain the assertions:

- the fake model returns a high-severity safeguarding result with high confidence;
- application policy still records `SAFEGUARDING_CATEGORY` and `HIGH_SEVERITY`;
- the analysis run and case become `REVIEW_REQUIRED` in the same transaction;
- the model has no path that can override these rules.

Show the minimized queue:

```bash
curl "http://localhost:3000/api/reviews?status=required"
```

**Job signal:** humans stay in control through deterministic, tested application policy rather than prompt wording.

## 6. Prove malformed-output fallback — 50 seconds

Run the focused deterministic test:

```bash
npm test -- tests/unit/reliable-analysis.service.test.ts -t "returns a fail-closed fallback after repeated invalid output"
```

Explain the sequence while it runs:

```text
invalid output -> one corrective retry -> invalid again
               -> analysis: null
               -> MODEL_OUTPUT_INVALID
               -> mandatory human review
```

The service does not coerce an almost-valid result, invent missing fields, retry indefinitely, or silently drop the case.

**Job signal:** failure injection and safe degradation are first-class behavior.

## 7. Present evaluation evidence — 60 seconds

Open the latest local `evals/results/latest.json` or the observed-results table in `docs/phase-12-evaluation-harness.md`. State the context before the percentages:

- dataset: `golden-v1`, 30 synthetic, project-labeled fixtures, six categories;
- same schema validation and deterministic policy used by the application;
- recorded Groq sample: 100% schema validity, 100% category agreement, 80% severity agreement, 96.7% review-required agreement, and 100% critical-review recall;
- all four committed regression gates passed, while seven detailed misses remained visible;
- cost is reported unavailable because the repository has no reviewed pricing configuration.

Show the comparison command, but do not run a paid live evaluation during the timed demo:

```bash
npm run eval:compare -- path/to/baseline.json path/to/candidate.json
```

Say explicitly that thresholds detect regressions on a small synthetic dataset; they do not establish legal correctness, production safety, fairness, or real-world performance.

**Job signal:** model behavior is evaluated with fixtures, gates, latency/token evidence, and honest limitations rather than anecdotes.

## 8. Show delivery controls — 40 seconds

Open the latest green GitHub Actions run and summarize:

- push/PR CI uses `npm ci` and no LLM secret;
- deterministic tests, migrations, real PostgreSQL integration tests, build, and Prisma validation all run automatically;
- live evaluation is a separate manual workflow with a protected secret and retained minimized artifact;
- the Docker image is multi-stage, non-root, read-only at runtime, and gated on database migration/readiness.

**Job signal:** the work can move from prompt and fixture to a reviewable, reproducible merged change.

## 9. Close with limitations and next step — 30 seconds

Name the limitations rather than waiting to be asked: no authentication or authorization, a small synthetic dataset without expert labels, only one bounded read-only tool, no autonomous final decisions, no provider-parity evidence, and no production security/legal/data-protection review.

The next meaningful product increment is not another model feature. It is an authenticated reviewer workflow with roles, tenant isolation, immutable reviewer actions, retention controls, and domain-expert validation of the policy and dataset.

**Job signal:** calibrated claims, prioritization, and ownership of the line the system must not cross.

## Recovery notes

- **Provider `429`/`503`:** explain the normalized failure and continue with deterministic tests; do not hide the failure.
- **No LLM configuration:** the analysis endpoint correctly returns `503 ANALYSIS_UNAVAILABLE`; use the pre-run evaluation artifact and deterministic tests.
- **Database not ready:** run `docker compose ps`, then `docker compose logs migrate api`; do not run development migrations in the container.
- **Demo time is short:** skip the optional invalid-create call and retrieval; keep both failure demonstrations and the limitations close.
- **Cleanup:** `docker compose down` preserves the local database volume. Do not add `--volumes` unless an intentional local reset is wanted.
