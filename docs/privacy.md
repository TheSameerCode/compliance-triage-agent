# Privacy and Data Protection

## Demo boundary

This repository is a public engineering demonstration. Every committed case, seed record, fixture, and example is synthetic. Do not enter real allegations, safeguarding information, background-check data, names, contact details, or other personal data into this demo.

The repository does **not** claim production readiness, legal approval, or GDPR compliance. Its safeguards demonstrate engineering intent; they do not replace organizational, security, or legal controls.

## Data minimization in the demo

- HTTP logs contain operational metadata such as request IDs, case IDs, routes, status codes, latency, and error codes.
- Logs intentionally exclude case descriptions, request bodies, authorization headers, API keys, raw prompts, and complete provider responses.
- Analysis events use an allow list of operational fields and include tool names only, never tool arguments or results.
- API errors are sanitized and do not expose database connection details or internal exception messages.
- The case lookup response omits provider payloads, token/cost data, and other internal trace fields.
- Persisted analysis traces contain model/prompt versions, retry and latency data, available token counts, and allow-listed tool names; they contain no hidden reasoning or raw report text.
- Seed and test records use pseudonymous references and synthetic narratives.

Database records still contain the submitted case description because persistence is part of the demonstration. Anyone running the project is responsible for keeping the database synthetic and appropriately isolated.

Calling `POST /api/cases/:id/analyze` sends the stored synthetic case description to the configured external model provider. Creating or retrieving a case does not call a model. Do not use the analyze endpoint with real reports unless the deployment has completed the required privacy, security, contractual, and legal review.

Provider settings are not a substitute for a privacy review. OpenAI and Gemini requests opt out of provider-side interaction storage where their APIs expose that control. Groq data retention, including Zero Data Retention, is configured in the Groq account rather than per request. No provider configuration in this demo is a GDPR-compliance claim.

## Requirements for a real deployment

A real compliance system would require design and approval beyond this repository, including:

- authentication, authorization, tenant isolation, and least-privilege access;
- a documented lawful basis and applicable data-protection impact assessment;
- provider and subprocessor review, data-processing agreements, and transfer assessment;
- encryption in transit and at rest with managed secret and key rotation;
- retention, deletion, legal-hold, backup, and incident-response policies;
- auditable access and change records with carefully controlled log retention;
- secure hosting, network controls, monitoring, vulnerability management, and recovery testing;
- human review procedures and governance for model-assisted decisions.

These controls depend on the deployment context and must be reviewed with qualified security, privacy, and legal stakeholders before real personal or compliance data is processed.
