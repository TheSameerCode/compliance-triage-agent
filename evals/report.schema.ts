import { z } from 'zod';

import { analysisCategorySchema, analysisSeveritySchema } from '../src/domain/analysis.schemas.js';
import { reviewReasonSchema } from '../src/domain/decision.schemas.js';

const ratioMetricSchema = z
  .object({
    matched: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    rate: z.number().min(0).max(1),
  })
  .strict();

const retryMetricSchema = z
  .object({
    totalRetries: z.number().int().nonnegative(),
    totalCases: z.number().int().nonnegative(),
    average: z.number().nonnegative(),
  })
  .strict();

const latencyMetricSchema = z
  .object({
    average: z.number().nonnegative(),
    p50: z.number().nonnegative(),
    p95: z.number().nonnegative(),
  })
  .strict();

const tokenUsageMetricSchema = z
  .object({
    availableCases: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();

const evaluationMetricsSchema = z
  .object({
    totalCases: z.number().int().positive(),
    schemaValidRate: ratioMetricSchema,
    categoryAccuracy: ratioMetricSchema,
    severityAccuracy: ratioMetricSchema,
    reviewRequiredAccuracy: ratioMetricSchema,
    criticalReviewRecall: ratioMetricSchema,
    averageRetryCount: retryMetricSchema,
    latencyMs: latencyMetricSchema,
    tokenUsage: tokenUsageMetricSchema,
    estimatedCost: z
      .object({
        status: z.literal('unavailable'),
        reason: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict();

const evaluationCaseResultSchema = z
  .object({
    fixtureId: z.string().min(1),
    schemaValid: z.boolean(),
    actual: z
      .object({
        category: analysisCategorySchema.nullable(),
        severity: analysisSeveritySchema.nullable(),
        reviewRequired: z.boolean(),
        reviewReasons: z.array(reviewReasonSchema),
      })
      .strict(),
    matches: z
      .object({
        category: z.boolean(),
        severity: z.boolean(),
        reviewRequired: z.boolean(),
        requiredReviewReasons: z.boolean(),
      })
      .strict(),
    retryCount: z.number().int().nonnegative(),
    latencyMs: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    failureCode: z.string().min(1).max(100).optional(),
    failures: z.array(z.string().min(1).max(200)),
  })
  .strict();

const thresholdSchema = z
  .object({
    schemaValidRate: z.number().min(0).max(1),
    criticalReviewRecall: z.number().min(0).max(1),
    reviewRequiredAccuracy: z.number().min(0).max(1),
    categoryAccuracy: z.number().min(0).max(1),
  })
  .strict();

const gateSchema = z
  .object({
    metric: z.enum([
      'schemaValidRate',
      'criticalReviewRecall',
      'reviewRequiredAccuracy',
      'categoryAccuracy',
    ]),
    value: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1),
    passed: z.boolean(),
  })
  .strict();

export const evaluationReportSchema = z
  .object({
    schemaVersion: z.literal('eval-report-v1'),
    timestamp: z.iso.datetime(),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    promptVersion: z.string().min(1).max(100),
    dataset: z
      .object({
        version: z.string().min(1).max(100),
        hash: z.string().regex(/^[a-f0-9]{64}$/u),
        totalCases: z.number().int().positive(),
      })
      .strict(),
    thresholds: thresholdSchema,
    metrics: evaluationMetricsSchema,
    gates: z.array(gateSchema).length(4),
    passed: z.boolean(),
    cases: z.array(evaluationCaseResultSchema).min(1),
    failures: z.array(
      z
        .object({
          fixtureId: z.string().min(1),
          reasons: z.array(z.string().min(1).max(200)).min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
export type EvaluationCaseResult = EvaluationReport['cases'][number];
export type EvaluationMetrics = EvaluationReport['metrics'];
