/**
 * Give pre-multi-profile documents a profile.
 *
 * Documents uploaded before this week carry an `owner_id` (the account's auth
 * id) and no `profile_id`, so they are invisible to the reports timeline, which
 * reads by profile. Every one of them was uploaded by an account owner about
 * themselves — that is the only thing the platform could express at the time —
 * so each belongs to that account's own `self` profile.
 *
 * The mapping is asked of user-provider, which owns `profiles`, rather than
 * guessed here. An account whose profile cannot be resolved is skipped and
 * counted; nothing is written on a guess.
 *
 * Provider-owned documents are left alone: they belong to the practice, not to
 * a patient, and `profile_id` stays null for them on purpose.
 *
 * Safe to re-run — it only touches rows where `profile_id IS NULL`.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/src/db/backfill-document-profiles.ts [--dry-run]
 */
import { createLogger, createServiceClient } from '@longeny/utils';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db } from './index.js';
import { documents } from './schema.js';

const logger = createLogger('backfill-document-profiles');
const dryRun = process.argv.includes('--dry-run');

const userProvider = createServiceClient(
  'ai-content-service',
  config.USER_PROVIDER_SERVICE_URL,
  config.HMAC_SECRET,
);

async function main() {
  const owners = await db
    .select({ ownerId: documents.owner_id, count: sql<number>`COUNT(*)::int` })
    .from(documents)
    .where(and(isNull(documents.profile_id), eq(documents.owner_type, 'user')))
    .groupBy(documents.owner_id);

  if (owners.length === 0) {
    console.log('Nothing to backfill — every patient document already has a profile.');
    return;
  }

  console.log(
    `${owners.length} account(s) with unscoped documents${dryRun ? ' (dry run)' : ''}:\n`,
  );

  let updated = 0;
  let skipped = 0;

  for (const owner of owners) {
    let profileId: string;
    try {
      const response = await userProvider.post<{ data: { profileId: string } }>(
        '/internal/profiles/resolve',
        { authId: owner.ownerId },
      );
      profileId = response.data.profileId;
    } catch (error) {
      logger.warn({ ownerId: owner.ownerId, error }, 'Could not resolve a profile — skipping');
      console.log(`  ${owner.ownerId}: ${owner.count} document(s) — SKIPPED, no profile`);
      skipped += owner.count;
      continue;
    }

    if (dryRun) {
      console.log(`  ${owner.ownerId}: ${owner.count} document(s) → ${profileId}`);
      updated += owner.count;
      continue;
    }

    const rows = await db
      .update(documents)
      .set({ profile_id: profileId })
      .where(and(eq(documents.owner_id, owner.ownerId), isNull(documents.profile_id)))
      .returning({ id: documents.id });

    console.log(`  ${owner.ownerId}: ${rows.length} document(s) → ${profileId}`);
    updated += rows.length;
  }

  console.log(
    `\n${updated} document(s) ${dryRun ? 'would be scoped' : 'scoped'}, ${skipped} skipped.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
