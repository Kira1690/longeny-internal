import { and, eq } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db } from './index.js';
import { credentials, permissions, role_permissions, roles, user_roles } from './schema.js';

// ─────────────────────────────────────────────────────────────
// Permission definitions
// ─────────────────────────────────────────────────────────────

const permissionDefs = [
  { name: 'users:read', resource: 'users', action: 'read', description: 'View user profiles' },
  { name: 'users:write', resource: 'users', action: 'write', description: 'Update user profiles' },
  {
    name: 'users:delete',
    resource: 'users',
    action: 'delete',
    description: 'Delete user accounts',
  },
  {
    name: 'providers:read',
    resource: 'providers',
    action: 'read',
    description: 'View provider profiles',
  },
  {
    name: 'providers:write',
    resource: 'providers',
    action: 'write',
    description: 'Update provider profiles',
  },
  {
    name: 'providers:verify',
    resource: 'providers',
    action: 'verify',
    description: 'Verify provider credentials',
  },
  { name: 'bookings:read', resource: 'bookings', action: 'read', description: 'View bookings' },
  {
    name: 'bookings:write',
    resource: 'bookings',
    action: 'write',
    description: 'Create and update bookings',
  },
  {
    name: 'bookings:cancel',
    resource: 'bookings',
    action: 'cancel',
    description: 'Cancel bookings',
  },
  {
    name: 'payments:read',
    resource: 'payments',
    action: 'read',
    description: 'View payment information',
  },
  { name: 'payments:write', resource: 'payments', action: 'write', description: 'Create payments' },
  {
    name: 'payments:refund',
    resource: 'payments',
    action: 'refund',
    description: 'Process payment refunds',
  },
  { name: 'documents:read', resource: 'documents', action: 'read', description: 'View documents' },
  {
    name: 'documents:write',
    resource: 'documents',
    action: 'write',
    description: 'Create and update documents',
  },
  {
    name: 'documents:share',
    resource: 'documents',
    action: 'share',
    description: 'Share documents with others',
  },
  {
    name: 'admin:users',
    resource: 'admin',
    action: 'users',
    description: 'Administer user accounts',
  },
  {
    name: 'admin:providers',
    resource: 'admin',
    action: 'providers',
    description: 'Administer provider accounts',
  },
  {
    name: 'admin:analytics',
    resource: 'admin',
    action: 'analytics',
    description: 'View platform analytics',
  },
  {
    name: 'admin:moderation',
    resource: 'admin',
    action: 'moderation',
    description: 'Moderate platform content',
  },
  {
    name: 'admin:settings',
    resource: 'admin',
    action: 'settings',
    description: 'Manage platform settings',
  },
  // ── Multi-profile / family (RRO) ──
  {
    name: 'profiles:read',
    resource: 'profiles',
    action: 'read',
    description: 'View profiles owned by the account',
  },
  {
    name: 'profiles:write',
    resource: 'profiles',
    action: 'write',
    description: 'Create, update and deactivate profiles',
  },
  {
    name: 'consent:grant',
    resource: 'consent',
    action: 'grant',
    description: 'Record caregiver consent on a dependent profile',
  },
  // Intake is the clinical questionnaire the RRO classification is derived from.
  // Separate from `rro:*` because a patient fills it in and a clinician only
  // reads it — the same split the workspace surface needs in Week 8.
  {
    name: 'intake:read',
    resource: 'intake',
    action: 'read',
    description: 'View submitted RRO intake for a profile',
  },
  {
    name: 'intake:write',
    resource: 'intake',
    action: 'write',
    description: 'Submit RRO intake for a profile',
  },
  {
    name: 'rro:read',
    resource: 'rro',
    action: 'read',
    description: 'View RRO state and transition history',
  },
  {
    name: 'rro:write',
    resource: 'rro',
    action: 'write',
    description: 'Record RRO state transitions',
  },
  // Health tracking is its own resource. It was briefly guarded by `users:*`,
  // which reads as "manage user accounts" — a provider needs to see a patient's
  // progress without being able to edit their account.
  {
    name: 'progress:read',
    resource: 'progress',
    action: 'read',
    description: 'View health metrics, habits, goals and check-ins for a profile',
  },
  {
    name: 'progress:write',
    resource: 'progress',
    action: 'write',
    description: 'Record health metrics, habits, goals and check-ins for a profile',
  },
];

const rolePermissionMap: Record<string, string[]> = {
  user: [
    'users:read',
    'users:write',
    'providers:read',
    'bookings:read',
    'bookings:write',
    'bookings:cancel',
    'payments:read',
    'payments:write',
    'documents:read',
    'documents:write',
    'documents:share',
    // The account owner manages their own family profiles and consents on
    // behalf of dependents who have no login of their own.
    'profiles:read',
    'profiles:write',
    'consent:grant',
    'intake:read',
    'intake:write',
    'rro:read',
    'progress:read',
    'progress:write',
  ],
  provider: [
    'users:read',
    'providers:read',
    'providers:write',
    'bookings:read',
    'bookings:write',
    'bookings:cancel',
    'payments:read',
    'documents:read',
    'documents:write',
    'documents:share',
    // A provider reads the profiles assigned to them; which those are is the
    // service layer's decision. No profile writes, no consent authority.
    'profiles:read',
    // A clinician reads a patient's intake; the patient submits it.
    'intake:read',
    'rro:read',
    'rro:write',
    // A provider reads a patient's progress; only the patient records it.
    'progress:read',
  ],
  admin: permissionDefs.map((p) => p.name),
  super_admin: permissionDefs.map((p) => p.name),
};

async function upsertRole(name: string, description: string, isSystem: boolean) {
  const [existing] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(roles)
    .values({ name, description, is_system: isSystem })
    .returning();
  return created;
}

async function upsertPermission(perm: (typeof permissionDefs)[0]) {
  const [existing] = await db
    .select()
    .from(permissions)
    .where(eq(permissions.name, perm.name))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(permissions).values(perm).returning();
  return created;
}

/** Published fallbacks. Only ever reachable in development and test — see
 *  seedTestCredentials. */
const DEV_ADMIN_PASSWORD = 'Admin123!@#';
const DEV_SUPER_ADMIN_PASSWORD = 'SuperAdmin123!@#';

/**
 * Roles and permissions are reference data and are seeded everywhere. These two
 * accounts are not: they are active, email-verified, and hold admin and
 * super_admin with a password that is either committed to this repository or
 * supplied by the operator. Seeding them anywhere but a developer machine or a
 * test run hands that environment an administrator whose password is public, so
 * the caller gates this on NODE_ENV.
 */
async function seedTestCredentials(roleMap: Record<string, string>) {
  const targets = [
    {
      label: 'admin',
      email: 'admin@longeny.com',
      password: config.SEED_ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD,
      fromEnv: config.SEED_ADMIN_PASSWORD !== undefined,
      roleId: roleMap.admin,
    },
    {
      label: 'super_admin',
      email: 'superadmin@longeny.com',
      password: config.SEED_SUPER_ADMIN_PASSWORD ?? DEV_SUPER_ADMIN_PASSWORD,
      fromEnv: config.SEED_SUPER_ADMIN_PASSWORD !== undefined,
      roleId: roleMap.super_admin,
    },
  ];

  for (const target of targets) {
    console.log(`Creating test ${target.label} credential...`);

    let [credential] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.email, target.email))
      .limit(1);

    if (!credential) {
      const passwordHash = await Bun.password.hash(target.password, {
        algorithm: 'bcrypt',
        cost: 12,
      });

      [credential] = await db
        .insert(credentials)
        .values({
          email: target.email,
          password_hash: passwordHash,
          status: 'active',
          email_verified: true,
          last_password_change: new Date(),
        })
        .returning();
    }

    const [existingRole] = await db
      .select()
      .from(user_roles)
      .where(
        and(eq(user_roles.credential_id, credential.id), eq(user_roles.role_id, target.roleId)),
      )
      .limit(1);

    if (!existingRole) {
      await db.insert(user_roles).values({
        credential_id: credential.id,
        role_id: target.roleId,
      });
    }

    const source = target.fromEnv
      ? 'environment-supplied password'
      : 'development default password';
    console.log(`  Created ${target.label} credential: ${target.email} (${source})`);
  }
}

async function main() {
  console.log('Seeding auth database...\n');

  // --- Roles ---
  console.log('Creating roles...');
  const userRole = await upsertRole('user', 'Regular platform user/consumer', true);
  const providerRole = await upsertRole('provider', 'Wellness provider or coach', true);
  const adminRole = await upsertRole('admin', 'Platform administrator', true);
  const superAdminRole = await upsertRole(
    'super_admin',
    'Super administrator with full approval authority',
    true,
  );

  const roleMap: Record<string, string> = {
    user: userRole.id,
    provider: providerRole.id,
    admin: adminRole.id,
    super_admin: superAdminRole.id,
  };
  console.log('  Created 4 roles: user, provider, admin, super_admin');

  // --- Permissions ---
  console.log('Creating permissions...');
  const createdPerms = await Promise.all(permissionDefs.map(upsertPermission));
  const permMap = Object.fromEntries(createdPerms.map((p) => [p.name, p.id]));
  console.log(`  Created ${createdPerms.length} permissions`);

  // --- Role-Permission mappings ---
  console.log('Mapping permissions to roles...');
  let mappingCount = 0;
  for (const [roleName, permNames] of Object.entries(rolePermissionMap)) {
    const roleId = roleMap[roleName];
    if (!roleId) continue;
    for (const permName of permNames) {
      const permId = permMap[permName];
      if (!permId) continue;
      const [existing] = await db
        .select()
        .from(role_permissions)
        .where(
          and(eq(role_permissions.role_id, roleId), eq(role_permissions.permission_id, permId)),
        )
        .limit(1);
      if (!existing) {
        await db.insert(role_permissions).values({ role_id: roleId, permission_id: permId });
        mappingCount++;
      }
    }
  }
  console.log(`  Created ${mappingCount} role-permission mappings`);

  if (config.NODE_ENV === 'development' || config.NODE_ENV === 'test') {
    await seedTestCredentials(roleMap);
  } else {
    console.log(`Skipping test credentials: NODE_ENV=${config.NODE_ENV}.`);
    console.log(
      '  Administrators for this environment are created by registering and assigning the role.',
    );
  }

  console.log('\nSeed completed successfully!');
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
