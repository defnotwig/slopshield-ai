import {
  loadGitHubAppConfig,
  getGitHubAppStatus,
  isGitHubAppEnabled,
} from "./github-app.config.js";

/**
 * Unit tests for GitHub App environment configuration validation.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */
describe("GitHubAppConfig", () => {
  describe("loadGitHubAppConfig", () => {
    it("returns disabled config with defaults when no env vars set", () => {
      const config = loadGitHubAppConfig({});
      expect(config.enabled).toBe(false);
      expect(config.scanTimeout).toBe(300);
      expect(config.rateLimitPerInstallation).toBe(60);
      expect(config.globalConcurrentScans).toBe(10);
      expect(config.credentialsConfigured).toBe(false);
    });

    it("parses GITHUB_APP_ENABLED='true' as enabled", () => {
      const config = loadGitHubAppConfig({
        GITHUB_APP_ENABLED: "true",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        GITHUB_APP_WEBHOOK_SECRET: "whsec_test",
      });
      expect(config.enabled).toBe(true);
      expect(config.credentialsConfigured).toBe(true);
    });

    it("parses GITHUB_APP_ENABLED='false' as disabled", () => {
      const config = loadGitHubAppConfig({ GITHUB_APP_ENABLED: "false" });
      expect(config.enabled).toBe(false);
    });

    it("treats missing GITHUB_APP_ENABLED as false", () => {
      const config = loadGitHubAppConfig({});
      expect(config.enabled).toBe(false);
    });

    it("does not require credentials when disabled", () => {
      const config = loadGitHubAppConfig({ GITHUB_APP_ENABLED: "false" });
      expect(config.credentialsConfigured).toBe(false);
      expect(config.appId).toBeUndefined();
      expect(config.privateKey).toBeUndefined();
      expect(config.webhookSecret).toBeUndefined();
    });

    it("marks credentialsConfigured=false when enabled but credentials missing", () => {
      const config = loadGitHubAppConfig({ GITHUB_APP_ENABLED: "true" });
      expect(config.enabled).toBe(true);
      expect(config.credentialsConfigured).toBe(false);
    });

    it("marks credentialsConfigured=false when enabled but credentials are blank", () => {
      const config = loadGitHubAppConfig({
        GITHUB_APP_ENABLED: "true",
        GITHUB_APP_ID: "  ",
        GITHUB_APP_PRIVATE_KEY: "",
        GITHUB_APP_WEBHOOK_SECRET: "",
      });
      expect(config.enabled).toBe(true);
      expect(config.credentialsConfigured).toBe(false);
    });

    it("applies custom numeric values from env", () => {
      const config = loadGitHubAppConfig({
        GITHUB_APP_SCAN_TIMEOUT: "600",
        GITHUB_APP_RATE_LIMIT_PER_INSTALLATION: "120",
        GITHUB_APP_GLOBAL_CONCURRENT_SCANS: "20",
      });
      expect(config.scanTimeout).toBe(600);
      expect(config.rateLimitPerInstallation).toBe(120);
      expect(config.globalConcurrentScans).toBe(20);
    });

    it("uses defaults for unset numeric values", () => {
      const config = loadGitHubAppConfig({});
      expect(config.scanTimeout).toBe(300);
      expect(config.rateLimitPerInstallation).toBe(60);
      expect(config.globalConcurrentScans).toBe(10);
    });

    it("exposes credential values when fully configured", () => {
      const config = loadGitHubAppConfig({
        GITHUB_APP_ENABLED: "true",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: "key-content",
        GITHUB_APP_WEBHOOK_SECRET: "secret-value",
      });
      expect(config.appId).toBe("12345");
      expect(config.privateKey).toBe("key-content");
      expect(config.webhookSecret).toBe("secret-value");
    });

    it("handles case-insensitive 'True' for GITHUB_APP_ENABLED", () => {
      const config = loadGitHubAppConfig({
        GITHUB_APP_ENABLED: "True",
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "key",
        GITHUB_APP_WEBHOOK_SECRET: "sec",
      });
      expect(config.enabled).toBe(true);
      expect(config.credentialsConfigured).toBe(true);
    });
  });

  describe("getGitHubAppStatus", () => {
    it("returns 'skipped' when disabled", () => {
      expect(getGitHubAppStatus({})).toBe("skipped");
      expect(getGitHubAppStatus({ GITHUB_APP_ENABLED: "false" })).toBe("skipped");
    });

    it("returns 'configured' when enabled with all credentials", () => {
      expect(
        getGitHubAppStatus({
          GITHUB_APP_ENABLED: "true",
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "key",
          GITHUB_APP_WEBHOOK_SECRET: "secret",
        }),
      ).toBe("configured");
    });

    it("returns 'error' when enabled but credentials missing", () => {
      expect(getGitHubAppStatus({ GITHUB_APP_ENABLED: "true" })).toBe("error");
    });
  });

  describe("isGitHubAppEnabled", () => {
    it("returns false when disabled", () => {
      expect(isGitHubAppEnabled({})).toBe(false);
    });

    it("returns false when enabled but credentials missing", () => {
      expect(isGitHubAppEnabled({ GITHUB_APP_ENABLED: "true" })).toBe(false);
    });

    it("returns true when enabled with valid credentials", () => {
      expect(
        isGitHubAppEnabled({
          GITHUB_APP_ENABLED: "true",
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "key",
          GITHUB_APP_WEBHOOK_SECRET: "secret",
        }),
      ).toBe(true);
    });
  });
});
