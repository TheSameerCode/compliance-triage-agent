import { z } from 'zod';

export const llmEnvironmentSchema = z.object({
  LLM_PROVIDER: z.enum(['openai', 'gemini', 'groq']).default('openai'),
  LLM_MODEL: z.string().trim().min(1),
  LLM_API_KEY: z.string().trim().min(1),
});

export type LLMEnvironment = Readonly<z.infer<typeof llmEnvironmentSchema>>;

export function loadLLMEnvironment(
  input: Record<string, string | undefined> = process.env,
): LLMEnvironment {
  const result = llmEnvironmentSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid LLM environment configuration: ${details}`);
  }

  return Object.freeze(result.data);
}
