import * as fc from "fast-check";
import { RepositoryConfigService } from "./repository-config.service.js";

/**
 * Property 13: Default config application
 *
 * **Validates: Requirements 5.2**
 *
 * For any repository full name that has no RepositoryConfig record in the
 * database, getConfig(repoFullName) returns a config with scanThreshold = 70,
 * scanMode = 'full', and autoBlockEnabled = true.
 */
describe("Feature: github-pr-status-checks, Property 13: Default config application", () => {
  // Arbitrary that generates valid GitHub "owner/repo" full names
  const repoFullNameArb = fc
    .tuple(
      fc.stringMatching(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/),
      fc.stringMatching(/^[a-zA-Z0-9._-]{1,100}$/),
    )
    .map(([owner, repo]) => `${owner}/${repo}`);

  let service: RepositoryConfigService;

  beforeEach(() => {
    // Mock PrismaService so that repositoryConfig.findUnique always returns null
    // (simulating no config record exists in the database)
    const mockPrisma = {
      repositoryConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any;

    // AuditService is not used by getConfig, but required by the constructor
    const mockAuditService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new RepositoryConfigService(mockPrisma, mockAuditService);
  });

  it("should return default threshold=70, mode=full, autoBlock=true for any repo without config", async () => {
    await fc.assert(
      fc.asyncProperty(repoFullNameArb, async (repoFullName) => {
        const config = await service.getConfig(repoFullName);

        // Default values per Requirement 5.2
        expect(config.scanThreshold).toBe(70);
        expect(config.scanMode).toBe("full");
        expect(config.autoBlockEnabled).toBe(true);
        expect(config.repoFullName).toBe(repoFullName);
      }),
      { numRuns: 100 },
    );
  });
});
