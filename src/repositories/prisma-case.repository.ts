import { z } from 'zod';

import { DatabaseFailureError } from '../errors/application-error.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { reviewReasonSchema } from '../domain/decision.schemas.js';
import type {
  AnalysisRepository,
  PersistAnalysisCommand,
  PersistedAnalysisRecord,
} from './analysis.repository.js';
import type {
  AnalysisRunRecord,
  CaseRecord,
  CaseRepository,
  CreatedCaseRecord,
} from './case.repository.js';

const stringListSchema = z.array(z.string());
const reviewReasonsSchema = z.array(reviewReasonSchema);

export class PrismaCaseRepository implements CaseRepository, AnalysisRepository {
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

  async findInputById(id: string): Promise<Parameters<CaseRepository['create']>[0] | null> {
    try {
      const record = await this.prisma.case.findUnique({
        where: { id },
        select: {
          description: true,
          reporterType: true,
          subjectRef: true,
        },
      });

      if (record === null) {
        return null;
      }

      return {
        description: record.description,
        ...(record.reporterType === null ? {} : { reporterType: record.reporterType }),
        ...(record.subjectRef === null ? {} : { subjectRef: record.subjectRef }),
      };
    } catch (error) {
      throw new DatabaseFailureError({ cause: error });
    }
  }

  async persistAnalysis(
    caseId: string,
    command: PersistAnalysisCommand,
  ): Promise<PersistedAnalysisRecord> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const { outcome } = command;
        const analysisFields =
          outcome.analysisStatus === 'completed'
            ? {
                category: outcome.analysis.category,
                severity: outcome.analysis.severity,
                summary: outcome.analysis.summary,
                confidence: outcome.analysis.confidence,
                missingInformation: outcome.analysis.missingInformation,
                indicators: outcome.analysis.indicators,
                modelSuggestsHumanReview: outcome.analysis.modelSuggestsHumanReview,
              }
            : {
                category: null,
                severity: null,
                summary: null,
                confidence: null,
                missingInformation: [],
                indicators: [],
                modelSuggestsHumanReview: null,
              };
        const analysisRun = await transaction.analysisRun.create({
          data: {
            caseId,
            model: command.model,
            promptVersion: command.promptVersion,
            ...analysisFields,
            reviewRequired: outcome.reviewDecision.reviewRequired,
            reviewReasons: outcome.reviewDecision.reviewReasons,
            analysisStatus: outcome.analysisStatus,
            retryCount: command.retryCount,
            latencyMs: command.latencyMs,
            ...(command.inputTokens === undefined ? {} : { inputTokens: command.inputTokens }),
            ...(command.outputTokens === undefined ? {} : { outputTokens: command.outputTokens }),
          },
          select: {
            id: true,
            createdAt: true,
          },
        });
        const caseStatus = outcome.reviewDecision.reviewRequired ? 'REVIEW_REQUIRED' : 'ANALYZED';

        await transaction.case.update({
          where: { id: caseId },
          data: { status: caseStatus },
          select: { id: true },
        });

        return {
          id: analysisRun.id,
          caseStatus,
          createdAt: analysisRun.createdAt,
        };
      });
    } catch (error) {
      throw new DatabaseFailureError({ cause: error });
    }
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
