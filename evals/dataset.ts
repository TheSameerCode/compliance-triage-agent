import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEvaluationFixtures, type EvaluationFixture } from './cases.schema.js';

export const EVALUATION_DATASET_VERSION = 'golden-v1';

export interface EvaluationDataset {
  readonly version: string;
  readonly hash: string;
  readonly fixtures: readonly EvaluationFixture[];
  readonly sources: readonly string[];
}

const defaultFixturesDirectory = fileURLToPath(new URL('./fixtures', import.meta.url));

export function loadEvaluationDataset(
  fixturesDirectory = defaultFixturesDirectory,
): EvaluationDataset {
  const sourceNames = readdirSync(fixturesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(({ name }) => name)
    .sort();

  if (sourceNames.length === 0) {
    throw new Error(`No evaluation fixture files found in ${fixturesDirectory}`);
  }

  const hash = createHash('sha256');
  const fixtures: EvaluationFixture[] = [];
  const sourceByFixtureId = new Map<string, string>();

  for (const sourceName of sourceNames) {
    const sourcePath = resolve(fixturesDirectory, sourceName);
    const sourceText = readFileSync(sourcePath, 'utf8');
    let sourceValue: unknown;

    try {
      sourceValue = JSON.parse(sourceText) as unknown;
    } catch {
      throw new Error(`Invalid JSON in evaluation fixture file ${sourceName}`);
    }

    const sourceFixtures = parseEvaluationFixtures(sourceValue, sourceName);

    for (const fixture of sourceFixtures) {
      const firstSource = sourceByFixtureId.get(fixture.id);

      if (firstSource !== undefined) {
        throw new Error(
          `Duplicate evaluation fixture ID ${fixture.id} in ${firstSource} and ${sourceName}`,
        );
      }

      sourceByFixtureId.set(fixture.id, sourceName);
      fixtures.push(fixture);
    }

    hash.update(sourceName);
    hash.update('\0');
    hash.update(sourceText);
    hash.update('\0');
  }

  return {
    version: EVALUATION_DATASET_VERSION,
    hash: hash.digest('hex'),
    fixtures,
    sources: sourceNames,
  };
}
