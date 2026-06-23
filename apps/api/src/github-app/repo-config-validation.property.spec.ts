import * as fc from 'fast-check';
import { BadRequestException } from '@nestjs/common';
import { RepositoryConfigService } from './repository-config.service';
import { ALLOWED_SCAN_MODES } from './types';

/**
 * Property 12: Repository config validation
 * Validates: Requirements 5.3, 5.4
 *
 * Tests that validateThreshold accepts [0,100] integers and rejects everything else,
 * and that validateScanMode accepts only the 5 allowed scan mode strings.
 */
describe('Property 12: Repository config validation', () => {
  const service = new RepositoryConfigService(null as any, null as any);

  describe('validateThreshold', () => {
    /**
     * **Validates: Requirements 5.3**
     * For any integer in [0, 100] → validateThreshold returns that integer (no throw)
     */
    it('accepts any integer in [0, 100] and returns it', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 100 }), (value) => {
          const result = service.validateThreshold(value);
          expect(result).toBe(value);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 5.3**
     * For any integer outside [0, 100] → validateThreshold throws
     */
    it('rejects any integer outside [0, 100]', () => {
      const outsideRange = fc.oneof(
        fc.integer({ max: -1 }),
        fc.integer({ min: 101 }),
      );

      fc.assert(
        fc.property(outsideRange, (value) => {
          expect(() => service.validateThreshold(value)).toThrow(BadRequestException);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 5.3**
     * For any non-integer number (floats) → validateThreshold throws
     */
    it('rejects any non-integer number (floats)', () => {
      // Generate floats that are not integers
      const nonIntegerFloat = fc.double({
        min: -1e6,
        max: 1e6,
        noNaN: true,
        noDefaultInfinity: true,
      }).filter((v) => !Number.isInteger(v));

      fc.assert(
        fc.property(nonIntegerFloat, (value) => {
          expect(() => service.validateThreshold(value)).toThrow(BadRequestException);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 5.3**
     * For any non-number value (string, null, undefined, object, array, boolean) → validateThreshold throws
     */
    it('rejects any non-number value', () => {
      const nonNumber = fc.oneof(
        fc.string(),
        fc.constant(null),
        fc.constant(undefined),
        fc.object(),
        fc.array(fc.anything()),
        fc.boolean(),
      );

      fc.assert(
        fc.property(nonNumber, (value) => {
          expect(() => service.validateThreshold(value)).toThrow(BadRequestException);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('validateScanMode', () => {
    /**
     * **Validates: Requirements 5.4**
     * For any string that is one of the 5 allowed scan modes → validateScanMode returns it
     */
    it('accepts any of the 5 allowed scan mode strings', () => {
      const allowedMode = fc.constantFrom(...ALLOWED_SCAN_MODES);

      fc.assert(
        fc.property(allowedMode, (value) => {
          const result = service.validateScanMode(value);
          expect(result).toBe(value);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 5.4**
     * For any string NOT in the allowed set → validateScanMode throws
     */
    it('rejects any string not in the allowed set', () => {
      const disallowedString = fc.string().filter(
        (s) => !ALLOWED_SCAN_MODES.includes(s as any),
      );

      fc.assert(
        fc.property(disallowedString, (value) => {
          expect(() => service.validateScanMode(value)).toThrow(BadRequestException);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 5.4**
     * For any non-string value → validateScanMode throws
     */
    it('rejects any non-string value', () => {
      const nonString = fc.oneof(
        fc.integer(),
        fc.double({ noNaN: true }),
        fc.constant(null),
        fc.constant(undefined),
        fc.object(),
        fc.array(fc.anything()),
        fc.boolean(),
      );

      fc.assert(
        fc.property(nonString, (value) => {
          expect(() => service.validateScanMode(value)).toThrow(BadRequestException);
        }),
        { numRuns: 100 },
      );
    });
  });
});
