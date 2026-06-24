// Unit tests for the scanMode policy helpers.

import {
  analyzersForMode,
  shouldRunAiForMode,
  fileMatchesMode,
} from "./scan-mode.util";

describe("scan-mode.util", () => {
  describe("analyzersForMode", () => {
    it("returns null (all analyzers) for full and fast", () => {
      expect(analyzersForMode("full")).toBeNull();
      expect(analyzersForMode("fast")).toBeNull();
      expect(analyzersForMode("unknown-mode")).toBeNull();
    });

    it("returns scoped allowlists for the targeted modes", () => {
      expect(analyzersForMode("security-only")).toContain("secret-scanner");
      expect(analyzersForMode("security-only")).toContain("dependency-scanner");
      expect(analyzersForMode("frontend-only")).toContain("a11y-scanner");
      expect(analyzersForMode("backend-only")).toContain("architecture-scanner");
      // custom-rules participates in every scoped mode.
      for (const mode of ["security-only", "frontend-only", "backend-only"]) {
        expect(analyzersForMode(mode)).toContain("custom-rules");
      }
    });
  });

  describe("shouldRunAiForMode", () => {
    it("runs AI for every mode except fast", () => {
      expect(shouldRunAiForMode("full")).toBe(true);
      expect(shouldRunAiForMode("security-only")).toBe(true);
      expect(shouldRunAiForMode("frontend-only")).toBe(true);
      expect(shouldRunAiForMode("backend-only")).toBe(true);
      expect(shouldRunAiForMode("fast")).toBe(false);
    });
  });

  describe("fileMatchesMode", () => {
    const fe = { isFrontend: true, isBackend: false };
    const be = { isFrontend: false, isBackend: true };

    it("scopes by environment only for the *-only modes", () => {
      expect(fileMatchesMode("frontend-only", fe)).toBe(true);
      expect(fileMatchesMode("frontend-only", be)).toBe(false);
      expect(fileMatchesMode("backend-only", be)).toBe(true);
      expect(fileMatchesMode("backend-only", fe)).toBe(false);
      // Non-scoped modes accept everything.
      expect(fileMatchesMode("full", be)).toBe(true);
      expect(fileMatchesMode("fast", fe)).toBe(true);
    });
  });
});
