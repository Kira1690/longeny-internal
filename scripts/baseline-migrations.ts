/**
 * Mark a service's existing migrations as already applied, without running them.
 *
 * A database built with `drizzle-kit push` has the right schema and an empty
 * `drizzle.__drizzle_migrations`, so drizzle believes migration 0000 has never
 * run and tries to replay it — which fails on the first `CREATE TYPE` because
 * the enum is already there. The database is correct; only the bookkeeping is
 * missing.
 *
 * This records each migration's hash exactly as drizzle's migrator computes it
 * (SHA-256 over the whole file), so the next `drizzle-kit migrate` starts from
 * the right place and applies only what is genuinely new.
 *
 * Safe to re-run: a hash already present is left alone. Only point it at a
 * database whose schema really does match its migrations — on an empty database
 * run `drizzle-kit migrate`, which is the path the E2E suites verify.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   bun run scripts/baseline-migrations.ts <service-dir> <DATABASE_URL_VAR> [--through <tag>]
 *
 * Example:
 *   bun run scripts/baseline-migrations.ts ai-content-service AI_CONTENT_DATABASE_URL --through 0000_baseline
 *
 * `--through` stops after the named migration. Without it every migration in the
 * journal is marked applied, including ones the database has never seen — which
 * silently skips them forever. Pass the last migration the database actually
 * contains, then run `drizzle-kit migrate` for the rest.
 */
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

interface JournalEntry {
  tag: string;
  when: number;
}

const args = process.argv.slice(2);
const throughIndex = args.indexOf('--through');
const through = throughIndex >= 0 ? args[throughIndex + 1] : undefined;
const [serviceDir, urlVar] = args.filter((a, i) => a !== '--through' && i !== throughIndex + 1);

if (!serviceDir || !urlVar) {
  console.error('Usage: bun run scripts/baseline-migrations.ts <service-dir> <DATABASE_URL_VAR>');
  process.exit(1);
}

const connectionString = process.env[urlVar];
if (!connectionString) {
  console.error(`${urlVar} is not set — source .env first`);
  process.exit(1);
}

const migrationsDir = join(import.meta.dir, '..', 'apps', serviceDir, 'src', 'db', 'migrations');
if (!existsSync(migrationsDir)) {
  console.error(`No migrations directory at ${migrationsDir}`);
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

async function main() {
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };

  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  if (through && !journal.entries.some((e) => e.tag === through)) {
    console.error(`--through ${through} is not in the journal`);
    process.exit(1);
  }

  let recorded = 0;
  let stop = false;
  for (const entry of journal.entries) {
    if (stop) {
      console.log(`  ${entry.tag}: left for drizzle-kit migrate`);
      continue;
    }
    if (entry.tag === through) stop = true;
    const query = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
    const hash = crypto.createHash('sha256').update(query).digest('hex');

    const existing =
      await sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash} LIMIT 1`;
    if (existing.length > 0) {
      console.log(`  ${entry.tag}: already recorded`);
      continue;
    }

    await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`;
    console.log(`  ${entry.tag}: recorded`);
    recorded++;
  }

  console.log(`\n${recorded} migration(s) baselined for ${serviceDir}.`);
}

main()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Baseline failed:', error);
    await sql.end();
    process.exit(1);
  });
