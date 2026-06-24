// Tests for the Gemini multi-key pool + automatic rotation on error.

import { GeminiProvider, resolveGeminiApiKeys } from "./gemini.provider";

const stubConfig = { get: () => undefined } as any;

/** Build a provider with an injected fake client pool (bypasses real SDK). */
function providerWithClients(clients: any[]): GeminiProvider {
  const p = new GeminiProvider(stubConfig);
  (p as any).clients = clients;
  (p as any).keyCursor = 0;
  return p;
}

function okClient(text: string) {
  return {
    models: {
      generateContent: jest.fn().mockResolvedValue({
        text,
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
      }),
    },
  };
}

function failingClient(message: string) {
  return {
    models: { generateContent: jest.fn().mockRejectedValue(new Error(message)) },
  };
}

describe("resolveGeminiApiKeys", () => {
  it("merges the single key with the comma list and de-duplicates", () => {
    expect(resolveGeminiApiKeys("k1", "k2, k3 ,k4")).toEqual([
      "k1",
      "k2",
      "k3",
      "k4",
    ]);
  });

  it("trims, drops blanks, and removes duplicates (single key first)", () => {
    expect(resolveGeminiApiKeys(" k1 ", "k1,, k2 ,k2")).toEqual(["k1", "k2"]);
  });

  it("returns an empty pool when nothing is configured", () => {
    expect(resolveGeminiApiKeys(undefined, undefined)).toEqual([]);
    expect(resolveGeminiApiKeys("", "  ,  ")).toEqual([]);
  });
});

describe("GeminiProvider.generateWithRotation", () => {
  it("rotates past a quota-exhausted key to the next working key", async () => {
    const bad = failingClient(
      'RESOURCE_EXHAUSTED: 429 quota exceeded for gemini-2.5-flash',
    );
    const good = okClient("ok");
    const provider = providerWithClients([bad, good]);

    const res = await (provider as any).generateWithRotation({}, "test");

    expect(res.text).toBe("ok");
    expect(bad.models.generateContent).toHaveBeenCalledTimes(1);
    expect(good.models.generateContent).toHaveBeenCalledTimes(1);
    // Cursor sticks to the working key for the next call.
    expect((provider as any).keyCursor).toBe(1);
  });

  it("keeps using the last working key on the next call", async () => {
    const bad = failingClient("429 rate limit");
    const good = okClient("second");
    const provider = providerWithClients([bad, good]);

    await (provider as any).generateWithRotation({}, "a");
    await (provider as any).generateWithRotation({}, "b");

    // After the first call moved the cursor to the good key, the second call
    // starts there and never touches the bad key again.
    expect(bad.models.generateContent).toHaveBeenCalledTimes(1);
    expect(good.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("throws after every key in the pool fails", async () => {
    const provider = providerWithClients([
      failingClient("429 a"),
      failingClient("503 b"),
      failingClient("429 c"),
    ]);

    await expect(
      (provider as any).generateWithRotation({}, "test"),
    ).rejects.toThrow(/All 3 Gemini API key\(s\) failed/);
  });
});
