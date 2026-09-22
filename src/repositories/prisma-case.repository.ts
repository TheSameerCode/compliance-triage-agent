import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { reviewReasonSchema } from '../domain/decision.schemas.js';
import type {
  AnalysisRunRecord,
  CaseRecord,
  CaseRepository,
  CreatedCaseRecord,
} from './case.repository.js';

const stringListSchema = z.array(z.string());
const reviewReasonsSchema = z.array(reviewReasonSchema);

export class PrismaCaseRepository implements CaseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async checkConnection(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async create(input: Parameters<CaseRepository['create']>[0]): Promise<CreatedCaseRecord> {
    return this.prisma.case.create({
      data: {
        description: input.description,
        ...(input.reporterType === undefined ? {} : { reporterType: input.reporterType }),
        ...(input.subjectRef === undefined ? {} : { subjectRef: input.subjectRef }),
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async findById(id: string): Promise<CaseRecord | null> {
    const record = await this.prisma.case.findUnique({
      where: { id },
      include: {
        analysisRuns: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        },
      },
    });

    if (record === null) {
      return null;
    }

    return {
      id: record.id,
      description: record.description,
      reporterType: record.reporterType,
      subjectRef: record.subjectRef,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      analysisRuns: record.analysisRuns.map((run): AnalysisRunRecord => ({
        id: run.id,
        analysisStatus: run.analysisStatus,
        category: run.category,
        severity: run.severity,
        summary: run.summary,
        confidence: run.confidence,
        missingInformation: stringListSchema.parse(run.missingInformation),
        indicators: stringListSchema.parse(run.indicators),
        modelSuggestsHumanReview: run.modelSuggestsHumanReview,
        reviewRequired: run.reviewRequired,
        reviewReasons: reviewReasonsSchema.parse(run.reviewReasons),
        createdAt: run.createdAt,
      })),
    };
  }
}
