import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
        'DATABASE_URL must use the postgres or postgresql protocol',
      ),
    LLM_PROVIDER: z.enum(['openai', 'gemini']).default('openai'),
    LLM_MODEL: optionalNonEmptyString,
    LLM_API_KEY: optionalNonEmptyString,
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    MAX_LLM_RETRIES: z.coerce.number().int().min(0).max(1).default(1),
    HUMAN_REVIEW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'test') {
      return;
    }

    if (environment.LLM_MODEL === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['LLM_MODEL'],
        message: 'LLM_MODEL is required outside test mode',
      });
    }

    if (environment.LLM_API_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: 'LLM_API_KEY is required outside test mode',
      });
    }
  });

export type Environment = Readonly<z.infer<typeof environmentSchema>>;

export function loadEnvironment(
  input: Record<string, string | undefined> = process.env,
): Environment {
  const result = environmentSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return Object.freeze(result.data);
}
