import { describe, expect, it, vi } from 'vitest';

import type { CaseAnalysis } from '../../src/domain/analysis.schemas.js';
import type { AnalysisRepository } from '../../src/repositories/analysis.repository.js';
import { type ReliableAnalyzer, TriageService } from '../../src/services/triage.service.js';

const caseInput = {
  description: 'A synthetic safeguarding report with enough detail for triage testing.',
  reporterType: 'member',
  subjectRef: 'subject_triage_01',
} as const;

const analysis: CaseAnalysis = {
  category: 'safeguarding',
  severity: 'high',
  summary: 'A neutral synthetic safeguarding summary.',
  missingInformation: ['Event date'],
  indicators: ['A safeguarding concern was reported.'],
  confidence: 0.7,
  modelSuggestsHumanReview: false,
};

function createDependencies() {
  const findInputById = vi.fn<AnalysisRepository['findInputById']>().mockResolvedValue(caseInput);
  const persistAnalysis = vi.fn<AnalysisRepository['persistAnalysis']>().mockResolvedValue({
    id: 'run_test_01',
    caseStatus: 'REVIEW_REQUIRED',
    createdAt: new Date('2026-09-22T10:00:00.000Z'),
  });
  const analyze = vi.fn<ReliableAnalyzer['analyze']>().mockResolvedValue({
    type: 'validated',
    analysis,
    retryCount: 1,
    toolNames: ['get_previous_cases'],
    trace: {
      model: 'fake-model-v2',
      promptVersion: 'triage-v1',
      providerResponseId: 'response-01',
      latencyMs: 20,
      usage: {
        inputTokens: 120,
        outputTokens: 50,
        totalTokens: 170,
      },
    },
  });

  return {
    repository: { findInputById, persistAnalysis } satisfies AnalysisRepository,
    reliableAnalyzer: { analyze } satisfies ReliableAnalyzer,
    findInputById,
    persistAnalysis,
    analyze,
  };
}

describe('TriageService', () => {
  it('applies policy and persists every review reason after model execution', async () => {
    const dependencies = createDependencies();
    const callOrder: string[] = [];
    dependencies.findInputById.mockImplementation(() => {
      callOrder.push('load');
      return Promise.resolve(caseInput);
    });
    dependencies.analyze.mockImplementation(() => {
      callOrder.push('analyze');
      return Promise.resolve({
        type: 'validated',
        analysis,
        retryCount: 1,
        toolNames: ['get_previous_cases'],
        trace: {
          model: 'fake-model-v2',
          promptVersion: 'triage-v1',
          providerResponseId: 'response-01',
          latencyMs: 20,
          usage: { inputTokens: 120, outputTokens: 50, totalTokens: 170 },
        },
      });
    });
    dependencies.persistAnalysis.mockImplementation(() => {
      callOrder.push('persist');
      return Promise.resolve({
        id: 'run_test_01',
        caseStatus: 'REVIEW_REQUIRED',
        createdAt: new Date('2026-09-22T10:00:00.000Z'),
      });
    });
    const service = new TriageService({
      repository: dependencies.repository,
      reliableAnalyzer: dependencies.reliableAnalyzer,
      model: 'configured-fallback-model',
      promptVersion: 'triage-v1',
      reviewPolicy: { confidenceThreshold: 0.75 },
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(145),
    });

    const result = await service.analyzeCase('case_test_01');

    expect(callOrder).toEqual(['load', 'analyze', 'persist']);
    expect(dependencies.analyze).toHaveBeenCalledWith(caseInput, {
      caseId: 'case_test_01',
    });
    expect(dependencies.persistAnalysis).toHaveBeenCalledWith('case_test_01', {
      outcome: {
        analysisStatus: 'completed',
        analysis,
        reviewDecision: {
          reviewRequired: true,
          reviewReasons: [
            'SAFEGUARDING_CATEGORY',
            'HIGH_SEVERITY',
            'LOW_CONFIDENCE',
            'MISSING_INFORMATION',
          ],
        },
      },
      model: 'fake-model-v2',
      promptVersion: 'triage-v1',
      retryCount: 1,
      latencyMs: 45,
      inputTokens: 120,
      outputTokens: 50,
      toolNames: ['get_previous_cases'],
    });
    expect(result).toMatchObject({
      analysisRunId: 'run_test_01',
      caseStatus: 'REVIEW_REQUIRED',
      analysisStatus: 'completed',
      retryCount: 1,
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: [
          'SAFEGUARDING_CATEGORY',
          'HIGH_SEVERITY',
          'LOW_CONFIDENCE',
          'MISSING_INFORMATION',
        ],
      },
      observability: {
        model: 'fake-model-v2',
        promptVersion: 'triage-v1',
        latencyMs: 45,
        schemaValidity: 'valid',
        toolNames: ['get_previous_cases'],
      },
    });
  });

  it('persists a provider fallback without invented analysis values', async () => {
    const dependencies = createDependencies();
    dependencies.analyze.mockResolvedValue({
      type: 'fallback',
      analysisStatus: 'fallback',
      analysis: null,
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: ['MODEL_CALL_FAILED'],
      },
      retryCount: 1,
      toolNames: ['get_previous_cases'],
      failure: { code: 'TIMEOUT' },
    });
    const service = new TriageService({
      repository: dependencies.repository,
      reliableAnalyzer: dependencies.reliableAnalyzer,
      model: 'configured-fallback-model',
      promptVersion: 'triage-v1',
      reviewPolicy: { confidenceThreshold: 0.75 },
      now: vi.fn().mockReturnValueOnce(200).mockReturnValueOnce(260),
    });

    const result = await service.analyzeCase('case_test_01');

    expect(dependencies.persistAnalysis).toHaveBeenCalledWith('case_test_01', {
      outcome: {
        analysisStatus: 'fallback',
        analysis: null,
        reviewDecision: {
          reviewRequired: true,
          reviewReasons: ['MODEL_CALL_FAILED'],
        },
      },
      model: 'configured-fallback-model',
      promptVersion: 'triage-v1',
      retryCount: 1,
      latencyMs: 60,
      toolNames: ['get_previous_cases'],
    });
    expect(result).toMatchObject({
      analysisStatus: 'fallback',
      analysis: null,
      caseStatus: 'REVIEW_REQUIRED',
      failure: { code: 'TIMEOUT' },
      observability: {
        model: 'configured-fallback-model',
        promptVersion: 'triage-v1',
        latencyMs: 60,
        schemaValidity: 'unavailable',
        toolNames: ['get_previous_cases'],
      },
    });
  });

  it('persists bounded trace metadata for an invalid-output fallback', async () => {
    const dependencies = createDependencies();
    dependencies.analyze.mockResolvedValue({
      type: 'fallback',
      analysisStatus: 'fallback',
      analysis: null,
      reviewDecision: {
        reviewRequired: true,
        reviewReasons: ['MODEL_OUTPUT_INVALID'],
      },
      retryCount: 1,
      toolNames: ['get_previous_cases'],
      failure: { code: 'MODEL_OUTPUT_INVALID' },
      lastTrace: {
        model: 'fake-model-invalid',
        promptVersion: 'triage-v1',
        providerResponseId: 'response-invalid-02',
        latencyMs: 30,
        usage: { inputTokens: 150, outputTokens: 20, totalTokens: 170 },
        tools: [{ toolName: 'get_previous_cases', latencyMs: 4 }],
      },
    });
    const service = new TriageService({
      repository: dependencies.repository,
      reliableAnalyzer: dependencies.reliableAnalyzer,
      model: 'configured-fallback-model',
      promptVersion: 'triage-v1',
      reviewPolicy: { confidenceThreshold: 0.75 },
      now: vi.fn().mockReturnValueOnce(300).mockReturnValueOnce(370),
    });

    const result = await service.analyzeCase('case_test_01');

    expect(dependencies.persistAnalysis).toHaveBeenCalledWith(
      'case_test_01',
      expect.objectContaining({
        model: 'fake-model-invalid',
        promptVersion: 'triage-v1',
        retryCount: 1,
        latencyMs: 70,
        inputTokens: 150,
        outputTokens: 20,
        toolNames: ['get_previous_cases'],
      }),
    );
    expect(result).toMatchObject({
      analysisStatus: 'fallback',
      observability: {
        model: 'fake-model-invalid',
        promptVersion: 'triage-v1',
        latencyMs: 70,
        schemaValidity: 'invalid',
        toolNames: ['get_previous_cases'],
      },
    });
    expect(JSON.stringify(dependencies.persistAnalysis.mock.calls)).not.toContain(
      'response-invalid-02',
    );
  });

  it('does not invoke a model or persistence for an unknown case', async () => {
    const dependencies = createDependencies();
    dependencies.findInputById.mockResolvedValue(null);
    const service = new TriageService({
      repository: dependencies.repository,
      reliableAnalyzer: dependencies.reliableAnalyzer,
      model: 'fake-model',
      promptVersion: 'triage-v1',
      reviewPolicy: { confidenceThreshold: 0.75 },
    });

    await expect(service.analyzeCase('unknown_case')).resolves.toBeNull();
    expect(dependencies.analyze).not.toHaveBeenCalled();
    expect(dependencies.persistAnalysis).not.toHaveBeenCalled();
  });
});
