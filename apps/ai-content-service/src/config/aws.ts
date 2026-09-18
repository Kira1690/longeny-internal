import { config } from './index.js';

/**
 * Explicit AWS keys, only when there are real ones.
 *
 * `AWS_ACCESS_KEY_ID` defaults to the literal `'test'` for LocalStack, and an
 * explicit credential — even a placeholder — wins over every other source in
 * the SDK's chain. Passing it unconditionally silently disables IAM roles: the
 * dev box has an instance role, and Bedrock still answered
 * `UnrecognizedClientException` because the client was signing with the word
 * "test". S3 had the same defect, which made every presigned report upload URL
 * on the dev box invalid.
 *
 * With no real keys the SDK's default chain is used, which is what makes an
 * instance role work in deployment while a developer's `.env` keys still work
 * locally. Every AWS client in this service takes its credentials from here.
 */
export function explicitAwsCredentials() {
  const hasRealKeys =
    config.AWS_ACCESS_KEY_ID !== 'test' && config.AWS_SECRET_ACCESS_KEY !== 'test';
  return hasRealKeys
    ? {
        credentials: {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {};
}

export const hasExplicitAwsKeys = () => 'credentials' in explicitAwsCredentials();
