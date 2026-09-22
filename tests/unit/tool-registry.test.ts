import { describe, expect, it, vi } from 'vitest';

import { ToolExecutionError } from '../../src/errors/application-error.js';
import type { PreviousCasesRepository } from '../../src/repositories/previous-cases.repository.js';
import {
  createPreviousCasesTool,
  GET_PREVIOUS_CASES_TOOL_NAME,
  previousCasesInputSchema,
  previousCasesOutputSchema,
} from '../../src/tools/previous-cases.tool.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';

const context = {
  caseId: 'case_current_01',
  subjectRef: 'subject_demo_01',
} as const;

function createRepository() {
  const getPreviousCaseMetadata = vi
    .fn<PreviousCasesRepository['getPreviousCaseMetadata']>()
    .mockResolvedValue({
      previousCaseCount: 2,
      categories: ['harassment', 'safeguarding'],
      hasOpenReview: true,
    });

  return {
    repository: { getPreviousCaseMetadata } satisfies PreviousCasesRepository,
    getPreviousCaseMetadata,
  };
}

describe('previous-case tool contracts', () => {
  it('strictly validates minimal input and output shapes', () => {
    expect(previousCasesInputSchema.safeParse({ subjectRef: 'subject_demo_01' }).success).toBe(
      true,
    );
    expect(
      previousCasesInputSchema.safeParse({
        subjectRef: 'subject_demo_01',
        description: 'must never be accepted',
      }).success,
    ).toBe(false);
    expect(
      previousCasesOutputSchema.safeParse({
        previousCaseCount: 2,
        categories: ['harassment', 'safeguarding'],
        hasOpenReview: true,
      }).success,
    ).toBe(true);
    expect(
      previousCasesOutputSchema.safeParse({
        previousCaseCount: 2,
        categories: ['harassment'],
        hasOpenReview: true,
        descriptions: ['must never cross the tool boundary'],
      }).success,
    ).toBe(false);
  });

  it('returns only validated metadata for the current subject', async () => {
    const { repository, getPreviousCaseMetadata } = createRepository();
    const tool = createPreviousCasesTool(repository);

    await expect(tool.execute({ subjectRef: 'subject_demo_01' }, context)).resolves.toEqual({
      previousCaseCount: 2,
      categories: ['harassment', 'safeguarding'],
      hasOpenReview: true,
    });
    expect(getPreviousCaseMetadata).toHaveBeenCalledWith('subject_demo_01', 'case_current_01');
    expect(tool.definition.name).toBe(GET_PREVIOUS_CASES_TOOL_NAME);
  });

  it('rejects invalid parameters and cross-subject lookup attempts', async () => {
    const { repository, getPreviousCaseMetadata } = createRepository();
    const tool = createPreviousCasesTool(repository);

    await expect(tool.execute({ subjectRef: 'other_subject' }, context)).rejects.toBeInstanceOf(
      ToolExecutionError,
    );
    await expect(tool.execute({ subjectRef: 42 }, context)).rejects.toBeInstanceOf(
      ToolExecutionError,
    );
    expect(getPreviousCaseMetadata).not.toHaveBeenCalled();
  });
});

describe('ToolRegistry', () => {
  it('executes only a registered tool and emits bounded trace metadata', async () => {
    const { repository } = createRepository();
    const registry = new ToolRegistry(
      [createPreviousCasesTool(repository)],
      vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(17.6),
    );

    const execution = await registry.execute(
      {
        id: 'call-01',
        name: GET_PREVIOUS_CASES_TOOL_NAME,
        arguments: { subjectRef: 'subject_demo_01' },
      },
      context,
    );

    expect(execution).toEqual({
      result: {
        callId: 'call-01',
        name: GET_PREVIOUS_CASES_TOOL_NAME,
        output: {
          previousCaseCount: 2,
          categories: ['harassment', 'safeguarding'],
          hasOpenReview: true,
        },
      },
      trace: { toolName: GET_PREVIOUS_CASES_TOOL_NAME, latencyMs: 8 },
    });
    expect(registry.definitions).toHaveLength(1);
  });

  it('rejects unknown and duplicate tool names with controlled errors', async () => {
    const { repository } = createRepository();
    const tool = createPreviousCasesTool(repository);
    const registry = new ToolRegistry([tool]);

    await expect(
      registry.execute({ id: 'call-unknown', name: 'delete_case', arguments: {} }, context),
    ).rejects.toBeInstanceOf(ToolExecutionError);
    expect(() => new ToolRegistry([tool, tool])).toThrow(
      `Duplicate tool registration: ${GET_PREVIOUS_CASES_TOOL_NAME}`,
    );
  });
});
