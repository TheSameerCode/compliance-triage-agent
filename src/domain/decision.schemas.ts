import { z } from 'zod';

import { caseAnalysisSchema } from './analysis.schemas.js';

export const reviewReasonSchema = z.enum([
  'HIGH_SEVERITY',
  'SAFEGUARDING_CATEGORY',
  'LOW_CONFIDENCE',
  'MISSING_INFORMATION',
  'MODEL_SUGGESTED_REVIEW',
  'MODEL_OUTPUT_INVALID',
  'MODEL_CALL_FAILED',
]);

export const analysisStatusSchema = z.enum(['completed', 'fallback']);

const reviewRequiredDecisionSchema = z
  .object({
    reviewRequired: z.literal(true),
    reviewReasons: z.array(reviewReasonSchema).min(1).max(reviewReasonSchema.options.length),
  })
  .strict();

const noReviewDecisionSchema = z
  .object({
    reviewRequired: z.literal(false),
    reviewReasons: z.array(reviewReasonSchema).length(0),
  })
  .strict();

export const reviewDecisionSchema = z.discriminatedUnion('reviewRequired', [
  reviewRequiredDecisionSchema,
  noReviewDecisionSchema,
]);

const completedAnalysisOutcomeSchema = z
  .object({
    analysisStatus: z.literal('completed'),
    analysis: caseAnalysisSchema,
    reviewDecision: reviewDecisionSchema,
  })
  .strict();

const fallbackReviewDecisionSchema = reviewRequiredDecisionSchema.refine(
  ({ reviewReasons }) =>
    reviewReasons.includes('MODEL_OUTPUT_INVALID') || reviewReasons.includes('MODEL_CALL_FAILED'),
  {
    path: ['reviewReasons'],
    message: 'Fallback requires MODEL_OUTPUT_INVALID or MODEL_CALL_FAILED',
  },
);

const fallbackAnalysisOutcomeSchema = z
  .object({
    analysisStatus: z.literal('fallback'),
    analysis: z.null(),
    reviewDecision: fallbackReviewDecisionSchema,
  })
  .strict();

export const analysisOutcomeSchema = z.discriminatedUnion('analysisStatus', [
  completedAnalysisOutcomeSchema,
  fallbackAnalysisOutcomeSchema,
]);

export type ReviewReason = z.infer<typeof reviewReasonSchema>;
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;
export type AnalysisOutcome = z.infer<typeof analysisOutcomeSchema>;
