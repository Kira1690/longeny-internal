/**
 * Backfill: give every pre-tenancy row a profile.
 *
 * Health data used to hang off `user_id` (the paying account). Under the
 * multi-profile model the subject of care is a profile, so every existing row
 * belongs to its account owner's `self` profile. Rows created before that
 * profile existed have `profile_id = NULL`, which the queries would otherwise
 * have to keep special-casing forever.
 *
 * Safe to re-run: every statement only touches rows that are still NULL, and a
 * missing self profile is created first.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/user-provider-service/src/db/backfill-profile-ids.ts
 */
import { sql } from 'drizzle-orm';
import { db } from './index.js';

/** Tables scoped directly from the account. habit_checkins fills from its habit. */
const TABLES = ['onboarding_state', 'progress_entries', 'habits', 'goals'] as const;

async function main() {
  console.log('Backfilling profile_id...\n');

  // 1. Every account needs a self profile before anything can point at one.
  const created = await db.execute(sql`
    INSERT INTO profiles (account_user_id, relation, is_self, first_name, last_name, status)
    SELECT u.id, 'self', true, u.first_name, u.last_name, 'active'
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM profiles p WHERE p.account_user_id = u.id AND p.is_self = true
    )
    RETURNING id
  `);
  console.log(`  self profiles created: ${created.length}`);

  // 2. Every self profile starts in RRO state 'intake'.
  const states = await db.execute(sql`
    INSERT INTO rro_state (profile_id, current_state)
    SELECT p.id, 'intake'
    FROM profiles p
    WHERE p.is_self = true
      AND NOT EXISTS (SELECT 1 FROM rro_state r WHERE r.profile_id = p.id)
    RETURNING id
  `);
  console.log(`  rro_state rows created: ${states.length}`);

  // 3. Point existing health data at the account owner's self profile.
  //
  // `user_id` on these tables is not consistent: routes that read the JWT store
  // the auth_id there, while rows written service-side store users.id. Until
  // that is unified (see the D2 card), match on either so no row is left behind.
  for (const table of TABLES) {
    const updated = await db.execute(sql`
      UPDATE ${sql.identifier(table)} t
      SET profile_id = p.id
      FROM users u
      JOIN profiles p ON p.account_user_id = u.id AND p.is_self = true
      WHERE (t.user_id = u.id OR t.user_id = u.auth_id)
        AND t.profile_id IS NULL
      RETURNING t.id
    `);
    console.log(`  ${table}: ${updated.length} rows scoped`);
  }

  // 4. habit_checkins is scoped through its habit rather than through the
  //    account, so it fills from the parent row and must run after step 3.
  const checkins = await db.execute(sql`
    UPDATE habit_checkins c
    SET profile_id = h.profile_id
    FROM habits h
    WHERE h.id = c.habit_id
      AND c.profile_id IS NULL
      AND h.profile_id IS NOT NULL
    RETURNING c.id
  `);
  console.log(`  habit_checkins: ${checkins.length} rows scoped`);

  // 5. Report anything still unscoped — rows whose account no longer exists.
  for (const table of [...TABLES, 'habit_checkins'] as const) {
    const orphans = await db.execute(sql`
      SELECT count(*)::int AS count FROM ${sql.identifier(table)} WHERE profile_id IS NULL
    `);
    const count = (orphans[0] as { count: number } | undefined)?.count ?? 0;
    if (count > 0) {
      console.warn(`  ! ${table}: ${count} rows still unscoped (no matching account)`);
    }
  }

  console.log('\nBackfill complete.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
