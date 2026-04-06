import crypto from 'node:crypto';

/**
 * Compute SHA-256 hex digest of a string.
 */
export function sha256(input: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(input);
  return hasher.digest('hex') as string;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns `iv:encrypted:authTag` in base64.
 */
export function encrypt(plaintext: string, key: string): string {
  const keyBuffer = Buffer.from(key, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag().toString('base64');
  const ivBase64 = iv.toString('base64');

  return `${ivBase64}:${encrypted}:${authTag}`;
}

/**
 * Decrypt ciphertext produced by `encrypt()`.
 */
export function decrypt(ciphertext: string, key: string): string {
  const [ivBase64, encrypted, authTagBase64] = ciphertext.split(':');

  if (!ivBase64 || !encrypted || !authTagBase64) {
    throw new Error('Invalid ciphertext format');
  }

  const keyBuffer = Buffer.from(key, 'hex');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Compute HMAC-SHA256 signature for inter-service communication.
 * Signature = HMAC-SHA256(secret, "${method}\n${path}\n${timestamp}\n${sha256(body)}")
 */
export function hmacSign(
  method: string,
  path: string,
  timestamp: string,
  body: string,
  secret: string,
): string {
  const bodyHash = sha256(body);
  const payload = `${method}\n${path}\n${timestamp}\n${bodyHash}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify an HMAC signature using timing-safe comparison.
 */
export function hmacVerify(
  signature: string,
  method: string,
  path: string,
  timestamp: string,
  body: string,
  secret: string,
): boolean {
  const expected = hmacSign(method, path, timestamp, body, secret);

  if (signature.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
