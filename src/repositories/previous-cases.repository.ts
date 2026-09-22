import type { PreviousCasesOutput } from '../tools/previous-cases.tool.js';

export interface PreviousCasesRepository {
  getPreviousCaseMetadata(subjectRef: string, excludeCaseId: string): Promise<PreviousCasesOutput>;
}
