import { z } from 'zod';

import { analysisCategorySchema } from '../domain/analysis.schemas.js';
import { subjectRefSchema } from '../domain/case.schemas.js';
import { ToolExecutionError } from '../errors/application-error.js';
import type { LLMToolDefinition } from '../llm/llm-client.interface.js';
import type { PreviousCasesRepository } from '../repositories/previous-cases.repository.js';

export const GET_PREVIOUS_CASES_TOOL_NAME = 'get_previous_cases';

export const previousCasesInputSchema = z
  .object({
    subjectRef: subjectRefSchema,
  })
  .strict();

export const previousCasesOutputSchema = z
  .object({
    previousCaseCount: z.number().int().nonnegative(),
    categories: z
      .array(analysisCategorySchema)
      .max(analysisCategorySchema.options.length)
      .refine((categories) => new Set(categories).size === categories.length, {
        message: 'Previous-case categories must be unique',
      }),
    hasOpenReview: z.boolean(),
  })
  .strict();

export type PreviousCasesInput = z.infer<typeof previousCasesInputSchema>;
export type PreviousCasesOutput = z.infer<typeof previousCasesOutputSchema>;

export interface ToolExecutionContext {
  readonly caseId: string;
  readonly subjectRef: string;
}

export interface PreviousCasesTool {
  readonly definition: LLMToolDefinition;
  execute(input: unknown, context: ToolExecutionContext): Promise<PreviousCasesOutput>;
}

export function createPreviousCasesTool(repository: PreviousCasesRepository): PreviousCasesTool {
  return {
    definition: {
      name: GET_PREVIOUS_CASES_TOOL_NAME,
      description:
        'Returns minimal metadata about earlier cases for the current pseudonymous subject reference. It never returns case narratives.',
      parameters: z.toJSONSchema(previousCasesInputSchema),
    },
    async execute(input, context) {
      const parsed = previousCasesInputSchema.safeParse(input);

      if (!parsed.success || parsed.data.subjectRef !== context.subjectRef) {
        throw new ToolExecutionError();
      }

      try {
        const output = await repository.getPreviousCaseMetadata(
          parsed.data.subjectRef,
          context.caseId,
        );

        return previousCasesOutputSchema.parse(output);
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          throw error;
        }

        throw new ToolExecutionError({ cause: error });
      }
    },
  };
}
