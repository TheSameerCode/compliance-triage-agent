import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/logging/logger.js';

describe('structured logger', () => {
  it('redacts sensitive analysis and provider fields as defense in depth', async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const logger = createLogger('info', destination);

    logger.info({
      event: 'synthetic.redaction_test',
      description: 'private-description-marker',
      caseInput: { description: 'nested-description-marker' },
      systemPrompt: 'private-prompt-marker',
      providerResponse: { internal: 'private-provider-marker' },
      toolArguments: { subjectRef: 'private-tool-argument-marker' },
      toolResults: { content: 'private-tool-result-marker' },
      apiKey: 'private-api-key-marker',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const output = chunks.join('');
    expect(output).toContain('synthetic.redaction_test');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('private-description-marker');
    expect(output).not.toContain('nested-description-marker');
    expect(output).not.toContain('private-prompt-marker');
    expect(output).not.toContain('private-provider-marker');
    expect(output).not.toContain('private-tool-argument-marker');
    expect(output).not.toContain('private-tool-result-marker');
    expect(output).not.toContain('private-api-key-marker');
  });
});
