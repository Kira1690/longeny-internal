import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/index.js';
import * as schema from './schema.js';

// Validated config, not a raw env read: AUTH_DATABASE_URL is required by the
// service config schema, so a missing value fails at boot with a named error.
const client = postgres(config.AUTH_DATABASE_URL);
export const db = drizzle(client, { schema });
