/**
 * Unit tests for the finding-detail drawer rendering real Finding fields.
 *
 * Covers Requirement 8.6: when a user opens a finding detail, the Web_App
 * displays the Finding fields including severity, category, recommendation, and
 * mapped Standard_Reference values.
 *
 * Strategy: the api-client is mocked to resolve a deterministic finding; the
 * test waits for the async fetch to settle and asserts each displayed field.
 *
 * _Requirements: 8.6_
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// --- Mocks -----------------------------------------------------------------

const getMock = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (path: string) => getMock(path),
    post: vi.fn(),
  },
}));

// CodeViewer wraps Monaco which is not loadable under jsdom; stub it.
vi.mock("@/components/code-viewer", () => ({
  CodeViewer: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

import React from "react";
import { FindingDetail } from "./finding-detail";

const FINDING = {
  id: "finding-1",
  filePath: "src/payments/charge.ts",
  lineNumber: 88,
  severity: "high",
  category: "security",
  title: "Unvalidated user input",
  description: "User input flows into a query without validation.",
  standardReferences: ["OWASP-A03 / CWE-89"],
  recommendation: "Use a parameterized query and validate input.",
  suggestedTests: ["Reject malicious SQL payloads"],
  blocking: false,
  confidence: 0.9,
  codeSnippet: "const q = `SELECT * FROM t WHERE id=${id}`;",
  falsePositive: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FindingDetail renders real Finding fields (Requirement 8.6)", () => {
  beforeEach(() => {
    getMock.mockResolvedValue(FINDING);
  });

  it("fetches the finding by id from the API", async () => {
    render(
      <FindingDetail findingId="finding-1" onClose={() => {}} onUpdate={() => {}} />,
    );
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/findings/finding-1"),
    );
  });

  it("displays the severity, category, recommendation, and standard reference", async () => {
    render(
      <FindingDetail findingId="finding-1" onClose={() => {}} onUpdate={() => {}} />,
    );

    // Title appears once the async fetch resolves.
    await waitFor(() =>
      expect(screen.getByText("Unvalidated user input")).toBeInTheDocument(),
    );

    // Severity badge text (severity rendered uppercase by the badge).
    expect(screen.getByText(/high/i)).toBeInTheDocument();
    // Category.
    expect(screen.getByText("security")).toBeInTheDocument();
    // Recommendation.
    expect(
      screen.getByText("Use a parameterized query and validate input."),
    ).toBeInTheDocument();
    // Mapped standard reference.
    expect(screen.getByText("OWASP-A03 / CWE-89")).toBeInTheDocument();
  });

  it("shows a not-found message when the finding cannot be resolved", async () => {
    getMock.mockResolvedValue(null);
    render(
      <FindingDetail findingId="missing" onClose={() => {}} onUpdate={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/finding not found/i)).toBeInTheDocument(),
    );
  });
});
