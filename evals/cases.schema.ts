import { z } from 'zod';

import { analysisCategorySchema, analysisSeveritySchema } from '../src/domain/analysis.schemas.js';
import { caseInputSchema } from '../src/domain/case.schemas.js';
import { reviewReasonSchema } from '../src/domain/decision.schemas.js';

const ambiguousCategoryExpectationSchema = z
  .object({
    oneOf: z
      .array(analysisCategorySchema)
      .min(2)
      .max(analysisCategorySchema.options.length)
      .refine((categories) => new Set(categories).size === categories.length, {
        message: 'Ambiguous category options must be unique',
      }),
  })
  .strict();

const ambiguousSeverityExpectationSchema = z
  .object({
    oneOf: z
      .array(analysisSeveritySchema)
      .min(2)
      .max(analysisSeveritySchema.options.length)
      .refine((severities) => new Set(severities).size === severities.length, {
        message: 'Ambiguous severity options must be unique',
      }),
  })
  .strict();

export const categoryExpectationSchema = z.union([
  analysisCategorySchema,
  ambiguousCategoryExpectationSchema,
]);

export const severityExpectationSchema = z.union([
  analysisSeveritySchema,
  ambiguousSeverityExpectationSchema,
]);

const expectedResultSchema = z
  .object({
    category: categoryExpectationSchema,
    severity: severityExpectationSchema,
    reviewRequired: z.boolean(),
    requiredReviewReasons: z
      .array(reviewReasonSchema)
      .min(1)
      .max(reviewReasonSchema.options.length)
      .refine((reasons) => new Set(reasons).size === reasons.length, {
        message: 'Required review reasons must be unique',
      })
      .optional(),
  })
  .strict()
  .superRefine((expected, context) => {
    if (!expected.reviewRequired && expected.requiredReviewReasons !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['requiredReviewReasons'],
        message: 'Review reasons cannot be required when reviewRequired is false',
      });
    }
  });

export const evaluationFixtureSchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9_]*-[0-9]{3}$/u, {
      message: 'Fixture ID must use a stable prefix and three digits, for example SAFE-001',
    }),
    input: caseInputSchema,
    expected: expectedResultSchema,
    tags: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/u)
          .max(64),
      )
      .min(1)
      .max(20)
      .refine((tags) => new Set(tags).size === tags.length, {
        message: 'Fixture tags must be unique',
      }),
  })
  .strict()
  .superRefine((fixture, context) => {
    const isCriticalReview = fixture.tags.includes('critical-review');

    if (fixture.expected.reviewRequired !== isCriticalReview) {
      context.addIssue({
        code: 'custom',
        path: ['tags'],
        message:
          'The critical-review tag must be present exactly when expected.reviewRequired is true',
      });
    }
  });

export const evaluationFixtureFileSchema = z
  .array(evaluationFixtureSchema)
  .min(1)
  .superRefine((fixtures, context) => {
    const firstIndexById = new Map<string, number>();

    fixtures.forEach((fixture, index) => {
      const firstIndex = firstIndexById.get(fixture.id);

      if (firstIndex !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `Duplicate fixture ID; first used at index ${firstIndex}`,
        });
        return;
      }

      firstIndexById.set(fixture.id, index);
    });
  });

export type EvaluationFixture = z.infer<typeof evaluationFixtureSchema>;
export type EvaluationFixtureFile = z.infer<typeof evaluationFixtureFileSchema>;

function getFixtureLabel(input: unknown, fixtureIndex: number): string {
  if (!Array.isArray(input)) {
    return 'file';
  }

  const fixtures = input as unknown[];
  const fixture: unknown = fixtures[fixtureIndex];

  if (typeof fixture === 'object' && fixture !== null && 'id' in fixture) {
    const id: unknown = (fixture as Record<string, unknown>).id;

    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }

  return `index ${fixtureIndex}`;
}

export function parseEvaluationFixtures(
  input: unknown,
  source = 'evaluation fixture input',
): EvaluationFixtureFile {
  const result = evaluationFixtureFileSchema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map((issue) => {
      const [fixtureIndex, ...fieldPath] = issue.path;
      const fixtureLabel =
        typeof fixtureIndex === 'number' ? getFixtureLabel(input, fixtureIndex) : 'file';
      const location = fieldPath.length > 0 ? fieldPath.join('.') : 'root';

      return `${fixtureLabel} at ${location}: ${issue.message}`;
    })
    .join('; ');

  throw new Error(`Invalid evaluation fixtures in ${source}: ${details}`);
}
