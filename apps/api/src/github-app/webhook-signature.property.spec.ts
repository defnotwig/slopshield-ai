import * as fc from "fast-check";
import {
  verifyWebhookSignature,
  computeWebhookSignature,
} from "./webhook-signature.js";

/**
 * Property-based tests for webhook HMAC-SHA256 signature verification.
 *
 * **Validates: Requirements 1.2, 1.3**
 *
 * Property 1: Webhook HMAC-SHA256 verification correctness
 * - For any random payload and secret, computing then verifying returns true.
 * - For any random payload and secret, using a different secret to verify returns false.
 * - For any random payload and secret, mutating any byte in the payload returns false.
 */
describe("Feature: github-pr-status-checks, Property 1: Webhook HMAC-SHA256 verification correctness", () => {
  describe("Round-trip: compute then verify returns true", () => {
    it("verifyWebhookSignature(payload, computeWebhookSignature(payload, secret), secret) === true for arbitrary payloads and secrets", () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 2048 }),
          fc.string({ minLength: 1, maxLength: 256 }),
          (payloadArray, secret) => {
            const payload = Buffer.from(payloadArray);
            const signature = computeWebhookSignature(payload, secret);
            return verifyWebhookSignature(payload, signature, secret) === true;
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Mutation: wrong secret returns false", () => {
    it("verifying with a different secret returns false", () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 2048 }),
          fc.string({ minLength: 1, maxLength: 256 }),
          fc.string({ minLength: 1, maxLength: 256 }),
          (payloadArray, secret, otherSecret) => {
            // Only test when secrets are actually different
            fc.pre(secret !== otherSecret);

            const payload = Buffer.from(payloadArray);
            const signature = computeWebhookSignature(payload, secret);
            return verifyWebhookSignature(payload, signature, otherSecret) === false;
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Mutation: flipped byte in payload returns false", () => {
    it("mutating any byte in the payload and verifying with the original signature returns false", () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 1, maxLength: 2048 }),
          fc.string({ minLength: 1, maxLength: 256 }),
          (payloadArray, secret) => {
            const payload = Buffer.from(payloadArray);
            const signature = computeWebhookSignature(payload, secret);

            // Mutate a random byte in the payload
            const mutatedArray = new Uint8Array(payloadArray);
            const indexToFlip = Math.floor(Math.random() * mutatedArray.length);
            // XOR with a non-zero value to ensure the byte actually changes
            mutatedArray[indexToFlip] = mutatedArray[indexToFlip]! ^ 0xff;
            const mutatedPayload = Buffer.from(mutatedArray);

            return (
              verifyWebhookSignature(mutatedPayload, signature, secret) === false
            );
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
