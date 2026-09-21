# Phase 1: Engineering Foundation

## Status

Phase 1 is complete. It establishes a reproducible TypeScript service baseline, strict runtime configuration, deterministic offline tests, formatting, and type-aware linting.

The foundation deliberately contains no compliance business logic or live model calls. Those are added only after the contracts, safety rules, and test boundaries are established.

## Completed work

| WBS task | Outcome                                                       | Evidence                       |
| -------- | ------------------------------------------------------------- | ------------------------------ |
| 0.1      | Public repository, secret-safe ignore rules, initial metadata | Commit `35ae3d7` and `c573f56` |
| 0.2      | Strict TypeScript/Node application skeleton                   | Commit `27c6a07`               |
| 0.3      | ESLint and Prettier with generated-file exclusions            | Commit `36488c6`               |
| 0.4      | Central Zod environment validation                            | Commit `3ecf8b7`               |
| 12.1     | Deterministic Vitest execution without a live LLM key         | Commit `6a5d43b`               |

## Resulting repository structure

```text
compliance-triage-agent/
├── docs/
│   └── phase-1-engineering-foundation.md
├── src/
│   ├── config/
│   │   └── env.ts
│   └── index.ts
├── tests/
│   └── unit/
│       └── env.test.ts
├── .env.example
├── .gitignore
├── .prettierignore
├── .prettierrc.json
├── eslint.config.js
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.test.json
└── vitest.config.ts
```

## Runtime and package baseline

The project uses Node.js 24 and ECMAScript modules.

Important package settings:

- `private: true` prevents accidental publication to npm.
- `type: module` enables native ECMAScript module behavior.
- `engines.node: >=24 <25` records the supported runtime line.
- `package-lock.json` is committed for reproducible dependency resolution.
- Build artifacts, coverage, local databases, dependencies, and `.env` files are ignored.

The TypeScript compiler is pinned to `~6.0.3`. TypeScript 7 was initially evaluated, but the current `typescript-eslint` peer range requires TypeScript below 6.1. The project keeps valid peer-dependency checks instead of bypassing them with `--force` or `--legacy-peer-deps`.

## TypeScript configuration

Production compilation is configured in [`tsconfig.json`](https://github.com/TheSameerCode/compliance-triage-agent/blob/main/tsconfig.json).

The baseline enables:

- strict type checking;
- explicit Node types;
- Node-native module resolution;
- unchecked-index protection;
- exact optional-property semantics;
- unknown catch variables;
- case-consistent file imports;
- separate `src` and `dist` directories;
- source maps for debugging.

Tests and tool configuration are checked through [`tsconfig.test.json`](https://github.com/TheSameerCode/compliance-triage-agent/blob/main/tsconfig.test.json). Keeping a separate test project prevents test files from being emitted into the production build while still subjecting them to strict type checking.

## Linting and formatting

[`eslint.config.js`](https://github.com/TheSameerCode/compliance-triage-agent/blob/main/eslint.config.js) uses ESLint flat configuration with type-aware TypeScript rules.

The configuration:

- treats warnings as failures;
- applies Node globals to application and configuration files;
- requires consistent type-only imports;
- uses both production and test TypeScript projects;
- excludes generated build output, coverage, evaluation results, dependencies, and generated Prisma migrations;
- disables stylistic ESLint rules that conflict with Prettier.

Prettier supplies the formatting contract. The work breakdown structure and generated files are excluded to avoid unrelated formatting churn.

Commands:

```bash
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

## Environment contract

Runtime configuration is defined once in [`src/config/env.ts`](https://github.com/TheSameerCode/compliance-triage-agent/blob/main/src/config/env.ts) and validated with Zod. Application modules should consume the validated configuration instead of reading `process.env` directly.

| Variable                            | Requirement                | Default or constraint                                        |
| ----------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `NODE_ENV`                          | Optional                   | `development`; allows `development`, `test`, or `production` |
| `PORT`                              | Optional                   | `3000`; integer from 1 through 65535                         |
| `DATABASE_URL`                      | Required in every mode     | Must use `postgres://` or `postgresql://`                    |
| `LLM_PROVIDER`                      | Optional                   | `openai`                                                     |
| `LLM_MODEL`                         | Required outside test mode | Non-empty string                                             |
| `LLM_API_KEY`                       | Required outside test mode | Non-empty string; never committed or logged                  |
| `LOG_LEVEL`                         | Optional                   | `info`; standard structured-log levels                       |
| `MAX_LLM_RETRIES`                   | Optional                   | `1`; constrained to 0 or 1                                   |
| `HUMAN_REVIEW_CONFIDENCE_THRESHOLD` | Optional                   | `0.75`; constrained to the range 0 through 1                 |

The loader returns a frozen typed object. Failed validation throws one clear error containing field names and validation reasons, but not environment values or secrets.

### Local configuration

Create a private development file from the committed template:

```powershell
Copy-Item .env.example .env
```

Replace the model placeholders locally when live-model work begins:

```dotenv
LLM_PROVIDER=openai
LLM_MODEL=<chosen-model>
LLM_API_KEY=<local-secret>
```

The `.env` file is ignored by Git. Never paste a real key into source code, documentation, fixtures, logs, issues, or commits.

### Test-mode behavior

Test mode still requires a database URL but deliberately does not require an LLM model or API key. This preserves deterministic offline testing and prevents ordinary CI runs from depending on model availability or paid credentials.

## Automated tests

[`vitest.config.ts`](https://github.com/TheSameerCode/compliance-triage-agent/blob/main/vitest.config.ts) configures deterministic Node-based tests.

The configuration:

- runs only versioned `tests/**/*.test.ts` files;
- disables file-level parallelism for a predictable baseline;
- restores mocks and environment/global stubs between tests;
- provides synthetic test configuration;
- does not provide or require an LLM key.

[`tests/unit/env.test.ts`](https://github.com/TheSameerCode/compliance-triage-agent/blob/main/tests/unit/env.test.ts) verifies that:

1. test configuration loads without an LLM API key;
2. invalid ports are rejected with a useful field name;
3. a missing database URL is rejected;
4. model and API-key configuration are required outside test mode.

A temporary deliberately failing assertion was also executed during setup. Vitest returned exit code 1, proving that test failures propagate correctly to CI. The failing test was removed after verification and was never committed.

## Available commands

| Command                | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run dev`          | Run the TypeScript entry point in watch mode                     |
| `npm run build`        | Compile production TypeScript into `dist`                        |
| `npm start`            | Start compiled output and optionally load `.env`                 |
| `npm test`             | Run deterministic tests once                                     |
| `npm run test:watch`   | Run tests interactively in watch mode                            |
| `npm run lint`         | Run type-aware linting with zero warnings allowed                |
| `npm run lint:fix`     | Apply safe ESLint fixes                                          |
| `npm run format`       | Format tracked source/configuration files                        |
| `npm run format:check` | Verify formatting without modifying files                        |
| `npm run typecheck`    | Type-check production and test projects without emitting files   |
| `npm run eval`         | Reserved for the real-model evaluation harness implemented later |

## Reproducing the Phase 1 checks

From the repository root:

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

Verified Phase 1 result:

```text
Formatting       PASS
Lint             PASS (zero warnings)
Type checking    PASS (production and tests)
Tests            PASS (4 tests)
Build            PASS
Dependency audit PASS (0 vulnerabilities)
```

To verify startup without a live model credential, supply test-mode configuration:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/compliance_agent_test'
npm start
```

Expected output:

```text
compliance-triage-agent initialized on port 3000
```

## Reliability and security decisions

- Runtime input is validated before application code consumes it.
- Missing or invalid required configuration fails startup explicitly.
- Error messages identify invalid fields without printing their values.
- Tests do not need network model access or a paid API key.
- `.env` and derived local secret files are ignored before secrets are introduced.
- Dependency peer conflicts are resolved with compatible versions, not forced installation.
- The `esbuild@0.28.2` install script is explicitly allow-listed because it is required by the reviewed TypeScript/Vitest toolchain; arbitrary dependency scripts are not globally enabled.
- Generated files and migrations do not create linting or formatting noise.
- The application currently logs only a service startup message and port, never report content or credentials.

## Problems found during setup

### Invalid dependency placeholders

The first package manifest contained literal `"..."` dependency versions copied from an illustrative snippet. npm interpreted them as local `file:...` dependencies, so the `tsc` executable was unavailable. Reinstalling the packages after removing the placeholders produced valid version ranges and a correct lockfile.

### TypeScript and ESLint compatibility

The latest TypeScript major version did not satisfy the current `typescript-eslint` peer range. TypeScript was pinned to the newest compatible 6.0 patch line. This avoids unsupported tooling combinations and keeps installation reproducible.

### Type-aware linting for test files

ESLint project-service discovery did not automatically select the separately named test configuration. The lint parser now receives explicit production and test project paths, so application code, tests, and Vitest configuration all receive type-aware linting.

## Phase 1 definition of done

- [x] Repository metadata and secret-safe ignores exist.
- [x] Node/TypeScript skeleton compiles and starts.
- [x] Strict production and test type checking passes.
- [x] ESLint passes with no warnings.
- [x] Prettier formatting is reproducible.
- [x] Environment configuration is typed and validated centrally.
- [x] Missing or invalid required configuration fails clearly.
- [x] Tests run without a live LLM credential.
- [x] Failed assertions return a non-zero process status.
- [x] Build output starts and exits cleanly in test mode.
- [x] All Phase 1 commits are pushed to `main`.

## Next phase

Phase 2 defines the domain contracts before introducing persistence or provider code:

1. WBS 1.1: case-input schema;
2. WBS 1.2: structured LLM-analysis schema;
3. WBS 1.3: final application-decision schema;
4. WBS 1.4: documented safety invariants;
5. WBS 12.2: schema unit tests;
6. WBS 10.1: evaluation-fixture schema.

This ordering keeps external model output untrusted until the application has explicit runtime contracts and deterministic safety boundaries.
