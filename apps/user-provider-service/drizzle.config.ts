import type { Config } from 'drizzle-kit';

const url = process.env.CORE_DATABASE_URL;
if (!url) throw new Error('CORE_DATABASE_URL must be set to run drizzle-kit');

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
} satisfies Config;
