import { z } from 'zod';

const evaluationEnvironmentSchema = z.object({
  HUMAN_REVIEW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  MAX_LLM_RETRIES: z.coerce.number().int().min(0).max(1).default(1),
  EVAL_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).max(60_000).optional(),
});

export type EvaluationEnvironment = Readonly<z.infer<typeof evaluationEnvironmentSchema>>;

export function loadEvaluationEnvironment(
  input: Record<string, string | undefined> = process.env,
): EvaluationEnvironment {
  const result = evaluationEnvironmentSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid evaluation environment configuration: ${details}`);
  }

  return Object.freeze(result.data);
}

export function resolveEvaluationRequestInterval(
  provider: string,
  configuredInterval: number | undefined,
): number {
  return configuredInterval ?? (provider === 'groq' ? 9_000 : 0);
}
