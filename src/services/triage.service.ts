import { performance } from 'node:perf_hooks';

import type { CaseAnalysis } from '../domain/analysis.schemas.js';
import type { CaseInput } from '../domain/case.schemas.js';
import type { AnalysisOutcome, ReviewDecision } from '../domain/decision.schemas.js';
import {
  createCompletedAnalysisOutcome,
  type ReviewPolicyConfig,
} from '../domain/review-policy.js';
import type {
  AnalysisRepository,
  PersistAnalysisCommand,
} from '../repositories/analysis.repository.js';
import type {
  ModelAnalysisFailureCode,
  ReliableAnalysisResult,
} from './reliable-analysis.service.js';
import type { AnalysisContext } from './analysis.service.js';

export interface ReliableAnalyzer {
  analyze(caseInput: CaseInput, context?: AnalysisContext): Promise<ReliableAnalysisResult>;
}

interface TriageResultBase {
  readonly analysisRunId: string;
  readonly caseStatus: 'ANALYZED' | 'REVIEW_REQUIRED';
  readonly retryCount: number;
  readonly createdAt: Date;
  readonly observability: AnalysisObservability;
}

export interface AnalysisObservability {
  readonly model: string;
  readonly promptVersion: string;
  readonly latencyMs: number;
  readonly schemaValidity: 'valid' | 'invalid' | 'unavailable';
  readonly toolNames: readonly string[];
}

export interface CompletedTriageResult extends TriageResultBase {
  readonly analysisStatus: 'completed';
  readonly analysis: CaseAnalysis;
  readonly reviewDecision: ReviewDecision;
}

export interface FallbackTriageResult extends TriageResultBase {
  readonly analysisStatus: 'fallback';
  readonly analysis: null;
  readonly reviewDecision: ReviewDecision & { readonly reviewRequired: true };
  readonly failure: {
    readonly code: ModelAnalysisFailureCode;
  };
}

export type TriageResult = CompletedTriageResult | FallbackTriageResult;

export interface CaseTriageService {
  analyzeCase(caseId: string): Promise<TriageResult | null>;
}

export interface TriageServiceDependencies {
  readonly repository: AnalysisRepository;
  readonly reliableAnalyzer: ReliableAnalyzer;
  readonly model: string;
  readonly promptVersion: string;
  readonly reviewPolicy: ReviewPolicyConfig;
  readonly now?: () => number;
}

function elapsedMilliseconds(start: number, end: number): number {
  return Math.max(0, Math.round(end - start));
}

export class TriageService implements CaseTriageService {
  private readonly repository: AnalysisRepository;
  private readonly reliableAnalyzer: ReliableAnalyzer;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly reviewPolicy: ReviewPolicyConfig;
  private readonly now: () => number;

  constructor({
    repository,
    reliableAnalyzer,
    model,
    promptVersion,
    reviewPolicy,
    now = () => performance.now(),
  }: TriageServiceDependencies) {
    this.repository = repository;
    this.reliableAnalyzer = reliableAnalyzer;
    this.model = model;
    this.promptVersion = promptVersion;
    this.reviewPolicy = reviewPolicy;
    this.now = now;
  }

  async analyzeCase(caseId: string): Promise<TriageResult | null> {
    const caseInput = await this.repository.findInputById(caseId);

    if (caseInput === null) {
      return null;
    }

    const startedAt = this.now();
    const result = await this.reliableAnalyzer.analyze(caseInput, { caseId });
    const latencyMs = elapsedMilliseconds(startedAt, this.now());
    const command = this.createPersistenceCommand(result, latencyMs);
    const persisted = await this.repository.persistAnalysis(caseId, command);
    const observability: AnalysisObservability = {
      model: command.model,
      promptVersion: command.promptVersion,
      latencyMs: command.latencyMs,
      schemaValidity:
        result.type === 'validated'
          ? 'valid'
          : result.failure.code === 'MODEL_OUTPUT_INVALID'
            ? 'invalid'
            : 'unavailable',
      toolNames: command.toolNames,
    };

    if (result.type === 'validated') {
      return {
        analysisRunId: persisted.id,
        caseStatus: persisted.caseStatus,
        createdAt: persisted.createdAt,
        analysisStatus: 'completed',
        analysis: result.analysis,
        reviewDecision: command.outcome.reviewDecision,
        retryCount: result.retryCount,
        observability,
      };
    }

    return {
      analysisRunId: persisted.id,
      caseStatus: persisted.caseStatus,
      createdAt: persisted.createdAt,
      analysisStatus: 'fallback',
      analysis: null,
      reviewDecision: result.reviewDecision,
      retryCount: result.retryCount,
      failure: result.failure,
      observability,
    };
  }

  private createPersistenceCommand(
    result: ReliableAnalysisResult,
    latencyMs: number,
  ): PersistAnalysisCommand {
    if (result.type === 'validated') {
      const outcome = createCompletedAnalysisOutcome(result.analysis, this.reviewPolicy);

      return {
        outcome,
        model: result.trace.model,
        promptVersion: result.trace.promptVersion,
        retryCount: result.retryCount,
        latencyMs,
        toolNames: result.toolNames,
        ...(result.trace.usage === undefined
          ? {}
          : {
              inputTokens: result.trace.usage.inputTokens,
              outputTokens: result.trace.usage.outputTokens,
            }),
      };
    }

    const outcome: AnalysisOutcome = {
      analysisStatus: 'fallback',
      analysis: null,
      reviewDecision: result.reviewDecision,
    };
    const trace = result.lastTrace;

    return {
      outcome,
      model: trace?.model ?? this.model,
      promptVersion: trace?.promptVersion ?? this.promptVersion,
      retryCount: result.retryCount,
      latencyMs,
      toolNames: [...new Set(result.toolNames)],
      ...(trace?.usage === undefined
        ? {}
        : {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
          }),
    };
  }
}
