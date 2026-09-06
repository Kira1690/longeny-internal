import crypto from 'node:crypto';

/**
 * Keyed digest for the `*_hash` lookup columns that sit beside encrypted PII.
 *
 * Those columns exist so a phone number or a notification destination can be
 * found without decrypting every row. That requires the digest to be
 * deterministic, which rules out a per-row random salt — but it must still be
 * keyed, or an attacker holding a dump could recover every value by hashing a
 * phone-number dictionary (the search space is small enough to exhaust).
 *
 * The key is derived from ENCRYPTION_KEY rather than used directly: the same
 * secret must never drive both AES-GCM and HMAC, and a labelled subkey costs
 * nothing. Bumping the label version re-keys every digest, so it is only safe
 * to change alongside a re-hash of the stored columns.
 */
const LOOKUP_HASH_LABEL = 'longeny:lookup-hash:v1';

export function lookupHash(value: string, encryptionKey: string): string {
  const subkey = crypto
    .createHmac('sha256', Buffer.from(encryptionKey, 'hex'))
    .update(LOOKUP_HASH_LABEL)
    .digest();
  // Trim only: a phone number is case-sensitive in no useful way, but callers
  // must otherwise present the value exactly as it was stored or the lookup
  // silently misses.
  return crypto.createHmac('sha256', subkey).update(value.trim()).digest('hex');
}

/** A stored value that is already a digest — used to make the re-hash idempotent. */
export function isLookupHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
