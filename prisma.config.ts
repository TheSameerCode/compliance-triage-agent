import 'dotenv/config';

import { defineConfig, env } from 'prisma/config';

const isClientGeneration = process.argv.includes('generate');
const databaseUrl =
  process.env.DATABASE_URL ??
  (isClientGeneration
    ? 'postgresql://client-generation:client-generation@localhost:5432/client-generation'
    : env('DATABASE_URL'));

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx scripts/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
