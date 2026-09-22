export interface EvaluationThresholds {
  readonly schemaValidRate: number;
  readonly criticalReviewRecall: number;
  readonly reviewRequiredAccuracy: number;
  readonly categoryAccuracy: number;
}

export const evaluationThresholds: EvaluationThresholds = Object.freeze({
  schemaValidRate: 1,
  criticalReviewRecall: 1,
  reviewRequiredAccuracy: 0.95,
  categoryAccuracy: 0.85,
});
