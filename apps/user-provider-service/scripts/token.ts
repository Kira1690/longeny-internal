/**
 * Mint a short-lived access token for local API testing.
 *
 *   set -a; source ../../.env; set +a
 *   bun run scripts/token.ts                       # seeded test account
 *   bun run scripts/token.ts <authId> <email>      # any account
 *
 * The token is a normal HS256 JWT signed with JWT_ACCESS_SECRET — identical to
 * what auth-service issues — so it is accepted by requireAuth across services.
 */
import jwt from 'jsonwebtoken';

const authId = process.argv[2] ?? '22222222-2222-2222-2222-222222222222';
const email = process.argv[3] ?? 'vishal.test@longeny.com';

const secret = process.env.JWT_ACCESS_SECRET;
if (!secret) {
  console.error('JWT_ACCESS_SECRET is not set — did you `source .env`?');
  process.exit(1);
}

const token = jwt.sign({ sub: authId, email, role: 'user', jti: crypto.randomUUID() }, secret, {
  expiresIn: '15m',
});
console.log(token);
