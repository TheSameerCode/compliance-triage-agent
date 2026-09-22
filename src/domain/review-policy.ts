import type { CaseAnalysis } from './analysis.schemas.js';
import type { AnalysisOutcome, ReviewDecision, ReviewReason } from './decision.schemas.js';

export interface ReviewPolicyConfig {
  readonly confidenceThreshold: number;
}

function validateConfidenceThreshold(confidenceThreshold: number): void {
  if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
    throw new RangeError('confidenceThreshold must be a finite number from 0 through 1');
  }
}

export function evaluateReviewPolicy(
  analysis: CaseAnalysis,
  { confidenceThreshold }: ReviewPolicyConfig,
): ReviewDecision {
  validateConfidenceThreshold(confidenceThreshold);

  const reviewReasons: ReviewReason[] = [];

  if (analysis.category === 'safeguarding') {
    reviewReasons.push('SAFEGUARDING_CATEGORY');
  }

  if (analysis.severity === 'high') {
    reviewReasons.push('HIGH_SEVERITY');
  }

  if (analysis.confidence < confidenceThreshold) {
    reviewReasons.push('LOW_CONFIDENCE');
  }

  if (analysis.missingInformation.length > 0) {
    reviewReasons.push('MISSING_INFORMATION');
  }

  if (analysis.modelSuggestsHumanReview) {
    reviewReasons.push('MODEL_SUGGESTED_REVIEW');
  }

  return reviewReasons.length > 0
    ? { reviewRequired: true, reviewReasons }
    : { reviewRequired: false, reviewReasons: [] };
}

export function createCompletedAnalysisOutcome(
  analysis: CaseAnalysis,
  config: ReviewPolicyConfig,
): Extract<AnalysisOutcome, { analysisStatus: 'completed' }> {
  return {
    analysisStatus: 'completed',
    analysis,
    reviewDecision: evaluateReviewPolicy(analysis, config),
  };
}
