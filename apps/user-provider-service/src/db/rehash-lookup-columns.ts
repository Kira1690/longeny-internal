/**
 * One-off: turn the plaintext `*_hash` lookup columns into real keyed digests.
 *
 * `profiles.phone_hash`, `users.phone_hash` and
 * `notification_targets.destination_hash` were written with the raw value, so
 * every row carried a plaintext copy of the datum sitting beside its own
 * ciphertext — a dump, a replica or one SQL injection returned the phone number
 * that `phone_encrypted` was there to protect. The service now writes
 * `lookupHash()` (see services/lookup-hash.ts); this repairs the rows written
 * before it.
 *
 * The digest is recomputed from the ENCRYPTED column wherever one exists, not
 * from the stale plaintext, so a row whose hash had drifted from its ciphertext
 * comes out consistent. Rows that already hold a digest are skipped, which makes
 * the script safe to re-run.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/user-provider-service/src/db/rehash-lookup-columns.ts
 */
import { decrypt } from '@longeny/utils';
import { sql } from 'drizzle-orm';
import { config } from '../config/index.js';
import { isLookupHash, lookupHash } from '../services/lookup-hash.js';
import { db } from './index.js';

const KEY = config.ENCRYPTION_KEY;

type Row = { id: string; encrypted: string | null; hash: string | null };

/**
 * The value a row's digest should be computed from: the ciphertext when it can
 * be read, otherwise the plaintext that is still sitting in the hash column.
 * Returns null when neither is usable, which leaves the row alone rather than
 * writing a digest of nothing.
 */
function plaintextFor(row: Row): string | null {
  if (row.encrypted) {
    try {
      return decrypt(row.encrypted, KEY);
    } catch {
      // Written under a different key — fall through to the stored plaintext.
    }
  }
  if (row.hash && !isLookupHash(row.hash)) return row.hash;
  return null;
}

async function rehash(table: string, encryptedColumn: string, hashColumn: string) {
  const rows = (await db.execute(sql`
    SELECT id,
           ${sql.identifier(encryptedColumn)} AS encrypted,
           ${sql.identifier(hashColumn)} AS hash
    FROM ${sql.identifier(table)}
    WHERE ${sql.identifier(hashColumn)} IS NOT NULL
      AND ${sql.identifier(hashColumn)} !~ '^[0-9a-f]{64}$'
  `)) as unknown as Row[];

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const plaintext = plaintextFor(row);
    if (!plaintext) {
      skipped++;
      continue;
    }
    await db.execute(sql`
      UPDATE ${sql.identifier(table)}
      SET ${sql.identifier(hashColumn)} = ${lookupHash(plaintext, KEY)}
      WHERE id = ${row.id}
    `);
    updated++;
  }

  console.log(
    `  ${table}.${hashColumn}: ${updated} re-hashed, ${skipped} skipped (no source value)`,
  );
}

async function verify(table: string, hashColumn: string) {
  const [{ count }] = (await db.execute(sql`
    SELECT count(*)::int AS count
    FROM ${sql.identifier(table)}
    WHERE ${sql.identifier(hashColumn)} IS NOT NULL
      AND ${sql.identifier(hashColumn)} !~ '^[0-9a-f]{64}$'
  `)) as unknown as [{ count: number }];

  if (count > 0) {
    console.warn(`  ! ${table}.${hashColumn}: ${count} row(s) still not a digest`);
  } else {
    console.log(`  ✓ ${table}.${hashColumn}: no plaintext remains`);
  }
}

async function main() {
  console.log('Re-hashing lookup columns...\n');

  await rehash('profiles', 'phone_encrypted', 'phone_hash');
  await rehash('users', 'phone_encrypted', 'phone_hash');
  await rehash('notification_targets', 'destination_encrypted', 'destination_hash');

  console.log('\nVerifying...');
  await verify('profiles', 'phone_hash');
  await verify('users', 'phone_hash');
  await verify('notification_targets', 'destination_hash');

  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Re-hash failed:', error);
    process.exit(1);
  });
