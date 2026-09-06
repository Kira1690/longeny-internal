import { defineConfig } from 'drizzle-kit';

const url = process.env.PAYMENT_DATABASE_URL;
if (!url) throw new Error('PAYMENT_DATABASE_URL must be set to run drizzle-kit');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
});
