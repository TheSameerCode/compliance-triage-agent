import { z } from 'zod';

export const analysisCategorySchema = z.enum([
  'safeguarding',
  'harassment',
  'discrimination',
  'financial',
  'privacy',
  'other',
]);

export const analysisSeveritySchema = z.enum(['low', 'medium', 'high']);

const analysisListItemSchema = z.string().trim().min(1).max(500);

export const caseAnalysisSchema = z
  .object({
    category: analysisCategorySchema,
    severity: analysisSeveritySchema,
    summary: z.string().trim().min(1).max(1_000),
    missingInformation: z.array(analysisListItemSchema).max(20),
    indicators: z.array(analysisListItemSchema).max(20),
    confidence: z.number().min(0).max(1),
    modelSuggestsHumanReview: z.boolean(),
  })
  .strict();

export type AnalysisCategory = z.infer<typeof analysisCategorySchema>;
export type AnalysisSeverity = z.infer<typeof analysisSeveritySchema>;
export type CaseAnalysis = z.infer<typeof caseAnalysisSchema>;
