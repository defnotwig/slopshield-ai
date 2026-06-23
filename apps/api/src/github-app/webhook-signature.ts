import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute the expected HMAC-SHA256 signature for a payload.
 * Returns the hex digest prefixed with "sha256=".
 *
 * @param payload - Raw request body bytes
 * @param secret - The configured webhook secret
 */
export function computeWebhookSignature(payload: Buffer, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  const hexDigest = hmac.digest('hex');
  return `sha256=${hexDigest}`;
}

/**
 * Verify a GitHub webhook HMAC-SHA256 signature.
 * Returns true if the signature matches, false otherwise.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param payload - Raw request body bytes
 * @param signature - Value of X-Hub-Signature-256 header (format: "sha256=<hex>")
 * @param secret - The configured webhook secret
 */
export function verifyWebhookSignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  // Handle missing or empty signature
  if (!signature) {
    return false;
  }

  // Signature must start with the "sha256=" prefix
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const expected = computeWebhookSignature(payload, secret);

  // Convert both to buffers for timing-safe comparison
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');

  // timingSafeEqual requires equal-length buffers
  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer);
}
