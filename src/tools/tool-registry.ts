import { performance } from 'node:perf_hooks';

import { ToolExecutionError } from '../errors/application-error.js';
import type { LLMToolCall, LLMToolDefinition, LLMToolResult } from '../llm/llm-client.interface.js';
import type { ToolExecutionContext } from './previous-cases.tool.js';

export interface RegisteredTool {
  readonly definition: LLMToolDefinition;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

export interface ToolExecutionTrace {
  readonly toolName: string;
  readonly latencyMs: number;
}

export interface ExecutedToolCall {
  readonly result: LLMToolResult;
  readonly trace: ToolExecutionTrace;
}

export class ToolRoundBudget {
  private remainingRounds = 1;

  get available(): boolean {
    return this.remainingRounds > 0;
  }

  tryConsume(): boolean {
    if (!this.available) {
      return false;
    }

    this.remainingRounds -= 1;
    return true;
  }
}

function elapsedMilliseconds(start: number, end: number): number {
  return Math.max(0, Math.round(end - start));
}

export class ToolRegistry {
  readonly definitions: readonly LLMToolDefinition[];
  private readonly tools: ReadonlyMap<string, RegisteredTool>;
  private readonly now: () => number;

  constructor(tools: readonly RegisteredTool[], now: () => number = () => performance.now()) {
    const toolsByName = new Map<string, RegisteredTool>();

    for (const tool of tools) {
      if (toolsByName.has(tool.definition.name)) {
        throw new Error(`Duplicate tool registration: ${tool.definition.name}`);
      }

      toolsByName.set(tool.definition.name, tool);
    }

    this.tools = toolsByName;
    this.definitions = tools.map(({ definition }) => definition);
    this.now = now;
  }

  async execute(call: LLMToolCall, context: ToolExecutionContext): Promise<ExecutedToolCall> {
    const tool = this.tools.get(call.name);

    if (tool === undefined) {
      throw new ToolExecutionError();
    }

    const startedAt = this.now();
    const output = await tool.execute(call.arguments, context);

    return {
      result: {
        callId: call.id,
        name: call.name,
        output,
      },
      trace: {
        toolName: call.name,
        latencyMs: elapsedMilliseconds(startedAt, this.now()),
      },
    };
  }
}
