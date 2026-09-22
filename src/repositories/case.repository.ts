import type { CaseInput } from '../domain/case.schemas.js';
import type { ReviewReason } from '../domain/decision.schemas.js';

export type CaseStatus = 'NEW' | 'ANALYZED' | 'REVIEW_REQUIRED';
export type AnalysisStatus = 'completed' | 'fallback';
export type AnalysisCategory =
  'safeguarding' | 'harassment' | 'discrimination' | 'financial' | 'privacy' | 'other';
export type AnalysisSeverity = 'low' | 'medium' | 'high';

export interface CreatedCaseRecord {
  readonly id: string;
  readonly status: CaseStatus;
  readonly createdAt: Date;
}

export interface AnalysisRunRecord {
  readonly id: string;
  readonly analysisStatus: AnalysisStatus;
  readonly category: AnalysisCategory | null;
  readonly severity: AnalysisSeverity | null;
  readonly summary: string | null;
  readonly confidence: number | null;
  readonly missingInformation: readonly string[];
  readonly indicators: readonly string[];
  readonly modelSuggestsHumanReview: boolean | null;
  readonly reviewRequired: boolean;
  readonly reviewReasons: readonly ReviewReason[];
  readonly createdAt: Date;
}

export interface CaseRecord extends CreatedCaseRecord {
  readonly description: string;
  readonly reporterType: string | null;
  readonly subjectRef: string | null;
  readonly updatedAt: Date;
  readonly analysisRuns: readonly AnalysisRunRecord[];
}

export interface ReviewQueueRecord {
  readonly id: string;
  readonly status: 'REVIEW_REQUIRED';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CaseRepository {
  checkConnection(): Promise<void>;
  create(input: CaseInput): Promise<CreatedCaseRecord>;
  findById(id: string): Promise<CaseRecord | null>;
  findRequiredReviews(): Promise<readonly ReviewQueueRecord[]>;
}
