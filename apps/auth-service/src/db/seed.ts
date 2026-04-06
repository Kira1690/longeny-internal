import { db } from './index.js';
import { roles, permissions, role_permissions, credentials, user_roles } from './schema.js';
import { eq, and } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────
// Permission definitions
// ─────────────────────────────────────────────────────────────

const permissionDefs = [
  { name: 'users:read', resource: 'users', action: 'read', description: 'View user profiles' },
  { name: 'users:write', resource: 'users', action: 'write', description: 'Update user profiles' },
  { name: 'users:delete', resource: 'users', action: 'delete', description: 'Delete user accounts' },
  { name: 'providers:read', resource: 'providers', action: 'read', description: 'View provider profiles' },
  { name: 'providers:write', resource: 'providers', action: 'write', description: 'Update provider profiles' },
  { name: 'providers:verify', resource: 'providers', action: 'verify', description: 'Verify provider credentials' },
  { name: 'bookings:read', resource: 'bookings', action: 'read', description: 'View bookings' },
  { name: 'bookings:write', resource: 'bookings', action: 'write', description: 'Create and update bookings' },
  { name: 'bookings:cancel', resource: 'bookings', action: 'cancel', description: 'Cancel bookings' },
  { name: 'payments:read', resource: 'payments', action: 'read', description: 'View payment information' },
  { name: 'payments:write', resource: 'payments', action: 'write', description: 'Create payments' },
  { name: 'payments:refund', resource: 'payments', action: 'refund', description: 'Process payment refunds' },
  { name: 'documents:read', resource: 'documents', action: 'read', description: 'View documents' },
  { name: 'documents:write', resource: 'documents', action: 'write', description: 'Create and update documents' },
  { name: 'documents:share', resource: 'documents', action: 'share', description: 'Share documents with others' },
  { name: 'admin:users', resource: 'admin', action: 'users', description: 'Administer user accounts' },
  { name: 'admin:providers', resource: 'admin', action: 'providers', description: 'Administer provider accounts' },
  { name: 'admin:analytics', resource: 'admin', action: 'analytics', description: 'View platform analytics' },
  { name: 'admin:moderation', resource: 'admin', action: 'moderation', description: 'Moderate platform content' },
  { name: 'admin:settings', resource: 'admin', action: 'settings', description: 'Manage platform settings' },
];

const rolePermissionMap: Record<string, string[]> = {
  user: [
    'users:read', 'users:write', 'providers:read',
    'bookings:read', 'bookings:write', 'bookings:cancel',
    'payments:read', 'payments:write',
    'documents:read', 'documents:write', 'documents:share',
  ],
  provider: [
    'users:read', 'providers:read', 'providers:write',
    'bookings:read', 'bookings:write', 'bookings:cancel',
    'payments:read', 'documents:read', 'documents:write', 'documents:share',
  ],
  admin: permissionDefs.map((p) => p.name),
};

async function upsertRole(name: string, description: string, isSystem: boolean) {
  const [existing] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(roles).values({ name, description, is_system: isSystem }).returning();
  return created;
}

async function upsertPermission(perm: typeof permissionDefs[0]) {
  const [existing] = await db.select().from(permissions).where(eq(permissions.name, perm.name)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(permissions).values(perm).returning();
  return created;
}

async function main() {
  console.log('Seeding auth database...\n');

  // --- Roles ---
  console.log('Creating roles...');
  const userRole = await upsertRole('user', 'Regular platform user/consumer', true);
  const providerRole = await upsertRole('provider', 'Wellness provider or coach', true);
  const adminRole = await upsertRole('admin', 'Platform administrator', true);

  const roleMap: Record<string, string> = {
    user: userRole.id,
    provider: providerRole.id,
    admin: adminRole.id,
  };
  console.log(`  Created 3 roles: user, provider, admin`);

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
        .where(and(eq(role_permissions.role_id, roleId), eq(role_permissions.permission_id, permId)))
        .limit(1);
      if (!existing) {
        await db.insert(role_permissions).values({ role_id: roleId, permission_id: permId });
        mappingCount++;
      }
    }
  }
  console.log(`  Created ${mappingCount} role-permission mappings`);

  // --- Test admin credential ---
  console.log('Creating test admin credential...');
  const passwordHash = await Bun.password.hash('Admin123!@#', { algorithm: 'bcrypt', cost: 12 });

  let [adminCredential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.email, 'admin@longeny.com'))
    .limit(1);

  if (!adminCredential) {
    [adminCredential] = await db.insert(credentials).values({
      email: 'admin@longeny.com',
      password_hash: passwordHash,
      status: 'active',
      email_verified: true,
      last_password_change: new Date(),
    }).returning();
  }

  // Assign admin role
  const [existingRole] = await db
    .select()
    .from(user_roles)
    .where(
      and(
        eq(user_roles.credential_id, adminCredential.id),
        eq(user_roles.role_id, roleMap.admin),
      ),
    )
    .limit(1);

  if (!existingRole) {
    await db.insert(user_roles).values({
      credential_id: adminCredential.id,
      role_id: roleMap.admin,
    });
  }

  console.log(`  Created admin credential: admin@longeny.com`);
  console.log('\nSeed completed successfully!');
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
