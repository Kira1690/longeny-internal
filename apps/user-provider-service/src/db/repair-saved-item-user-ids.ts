/**
 * One-off: point `saved_items.user_id` at the account row, not the auth id.
 *
 * `saveItem` used to write the JWT `sub` — an auth-service id — into
 * `saved_items.user_id`, while `getAllUserDataForGdpr` and `deleteAllUserData`
 * read that column by `users.id`. The two never met: the GDPR export returned
 * `[]` and the erasure DELETE matched no rows, so a user who asked to be
 * forgotten kept every saved item. The service now resolves the auth id first
 * (see marketplace.service.ts `resolveAccountId`); this repairs the rows written
 * before it.
 *
 * `users.id` is the convention because it is what every other account-scoped
 * table already holds, and what both GDPR paths query.
 *
 * Safe to re-run: rows that already hold a `users.id` do not join to
 * `users.auth_id` and are left alone. Rows whose auth id matches no account are
 * reported rather than guessed at.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/user-provider-service/src/db/repair-saved-item-user-ids.ts
 */
import { sql } from 'drizzle-orm';
import { db } from './index.js';

async function main() {
  console.log('Repairing saved_items.user_id...\n');

  // The join is on auth_id only. A row already holding users.id cannot match a
  // different account's auth_id (both are v4 uuids from separate keyspaces), so
  // correct rows are untouched and the statement is idempotent.
  const repaired = await db.execute(sql`
    UPDATE saved_items s
    SET user_id = u.id
    FROM users u
    WHERE s.user_id = u.auth_id
      AND s.user_id <> u.id
    RETURNING s.id
  `);
  console.log(`  rows repointed at users.id: ${repaired.length}`);

  const orphans = (await db.execute(sql`
    SELECT count(*)::int AS count
    FROM saved_items s
    WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)
  `)) as unknown as Array<{ count: number }>;

  const count = orphans[0]?.count ?? 0;
  if (count > 0) {
    console.warn(
      `  ! ${count} row(s) still reference no account — their auth id matches no user. These are unreachable by the GDPR paths and should be deleted after review.`,
    );
  } else {
    console.log('  ✓ every saved item now resolves to a users row');
  }

  console.log('\nRepair complete.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Repair failed:', error);
    process.exit(1);
  });
