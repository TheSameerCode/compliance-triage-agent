import { z } from 'zod';

export const MIN_CASE_DESCRIPTION_LENGTH = 20;
export const MAX_CASE_DESCRIPTION_LENGTH = 12_000;

export const subjectRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z0-9_-]+$/u,
    'Subject reference may contain only letters, numbers, underscores, and hyphens',
  );

export const caseInputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(
        MIN_CASE_DESCRIPTION_LENGTH,
        `Description must contain at least ${MIN_CASE_DESCRIPTION_LENGTH} characters`,
      )
      .max(
        MAX_CASE_DESCRIPTION_LENGTH,
        `Description must contain at most ${MAX_CASE_DESCRIPTION_LENGTH} characters`,
      ),
    reporterType: z.string().trim().min(1).max(100).optional(),
    subjectRef: subjectRefSchema.optional(),
  })
  .strict();

export type CaseInput = z.infer<typeof caseInputSchema>;
