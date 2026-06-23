import { parseCorsAllowlist, buildCorsOriginCallback } from "./cors.js";

describe("cors allowlist", () => {
  describe("parseCorsAllowlist", () => {
    it("parses a single origin", () => {
      expect(parseCorsAllowlist("http://localhost:3000")).toEqual([
        "http://localhost:3000",
      ]);
    });

    it("parses a comma-separated list and trims whitespace", () => {
      expect(
        parseCorsAllowlist("http://localhost:3000, https://app.example.com"),
      ).toEqual(["http://localhost:3000", "https://app.example.com"]);
    });

    it("drops empty entries", () => {
      expect(parseCorsAllowlist("http://a.com,,  ,http://b.com")).toEqual([
        "http://a.com",
        "http://b.com",
      ]);
    });

    it("falls back to localhost when undefined", () => {
      expect(parseCorsAllowlist(undefined)).toEqual(["http://localhost:3000"]);
    });
  });

  describe("buildCorsOriginCallback", () => {
    const allowlist = ["http://localhost:3000", "https://app.example.com"];
    const cb = buildCorsOriginCallback(allowlist);

    it("allows a request whose origin is in the allowlist", () => {
      cb("https://app.example.com", (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
      });
    });

    it("allows a request with no origin header (same-origin / server-to-server)", () => {
      cb(undefined, (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
      });
    });

    it("rejects a request whose origin is not in the allowlist", () => {
      cb("https://evil.example.com", (err, allow) => {
        expect(err).toBeInstanceOf(Error);
        expect(allow).toBe(false);
      });
    });
  });
});
