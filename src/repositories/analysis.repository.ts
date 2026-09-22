import type { AnalysisOutcome } from '../domain/decision.schemas.js';
import type { CaseInput } from '../domain/case.schemas.js';

export interface PersistAnalysisCommand {
  readonly outcome: AnalysisOutcome;
  readonly model: string;
  readonly promptVersion: string;
  readonly retryCount: number;
  readonly latencyMs: number;
  readonly toolNames: readonly string[];
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface PersistedAnalysisRecord {
  readonly id: string;
  readonly caseStatus: 'ANALYZED' | 'REVIEW_REQUIRED';
  readonly createdAt: Date;
}

export interface AnalysisRepository {
  findInputById(id: string): Promise<CaseInput | null>;
  persistAnalysis(
    caseId: string,
    command: PersistAnalysisCommand,
  ): Promise<PersistedAnalysisRecord>;
}
