/**
 * Unit tests for scan-view states and repo-tab submission.
 *
 * Covers:
 *  - Requirement 3.1: the repo tab submits `sourceType: "repository"` via the
 *    shared SOURCE_TYPE constant.
 *  - Requirement 3.6: scan-related views render distinct loading, empty, and
 *    error states.
 *  - Requirement 3.7: when a scan query fails, the error state includes a
 *    retry affordance.
 *
 * _Requirements: 3.1, 3.6, 3.7_
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// --- Mocks -----------------------------------------------------------------

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light" }),
}));

// Mock Monaco editor since it's heavy and not needed for logic tests
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid="mock-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

// Mock lucide-react icons as simple spans
vi.mock("lucide-react", () => {
  const icons = [
    "Terminal", "Upload", "Link2", "Code", "ShieldAlert", "AlertTriangle",
    "Play", "HelpCircle", "Search", "Calendar", "RefreshCw", "FolderOpen",
    "ArrowRight", "ArrowLeft", "AlertCircle", "Loader2",
  ];
  const mocks: Record<string, any> = {};
  for (const name of icons) {
    mocks[name] = (props: any) => <span data-testid={`icon-${name}`} {...props} />;
  }
  return mocks;
});

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (url: string) => getMock(url),
    post: (url: string, body?: unknown) => postMock(url, body),
  },
}));

vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({ data: [] }),
}));

// Mock next/link as a simple anchor
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Import components after mocks
import NewScanPage from "./new/page";
import ScansHistoryPage from "./page";

// --- Helpers ---------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("NewScanPage — repo tab submission (Requirement 3.1)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    postMock.mockReset();
    getMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('submits sourceType: "repository" from the shared constant when using the repo tab', async () => {
    postMock.mockResolvedValue({ id: "scan-123" });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <NewScanPage />
      </Wrapper>,
    );

    // Click the Git Repo tab
    const repoTab = screen.getByRole("button", { name: /git repo/i });
    fireEvent.click(repoTab);

    // Fill in the repo URL
    const input = screen.getByPlaceholderText(/github\.com/i);
    fireEvent.change(input, {
      target: { value: "https://github.com/octocat/Hello-World" },
    });

    // Click the submit button
    const submitBtn = screen.getByRole("button", { name: /start audit scan/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    const [url, body] = postMock.mock.calls[0];
    expect(url).toBe("/scans");
    expect(body).toMatchObject({
      sourceType: "repository",
      sourceRef: "https://github.com/octocat/Hello-World",
    });
  });

  it('does not submit "git" as the sourceType value', async () => {
    postMock.mockResolvedValue({ id: "scan-456" });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <NewScanPage />
      </Wrapper>,
    );

    // Click the Git Repo tab
    const repoTab = screen.getByRole("button", { name: /git repo/i });
    fireEvent.click(repoTab);

    // Fill in the repo URL
    const input = screen.getByPlaceholderText(/github\.com/i);
    fireEvent.change(input, {
      target: { value: "https://github.com/octocat/Hello-World" },
    });

    // Click the submit button
    const submitBtn = screen.getByRole("button", { name: /start audit scan/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    const [, body] = postMock.mock.calls[0];
    expect(body.sourceType).not.toBe("git");
  });
});

describe("ScansHistoryPage — loading state (Requirement 3.6)", () => {
  it("renders a loading state while scan data is being fetched", () => {
    // getMock never resolves → query stays in loading state
    getMock.mockReturnValue(new Promise(() => {}));

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <ScansHistoryPage />
      </Wrapper>,
    );

    expect(screen.getByText(/fetching scan history/i)).toBeInTheDocument();
  });
});

describe("ScansHistoryPage — empty state (Requirement 3.6)", () => {
  it("renders an empty state when no scans match", async () => {
    getMock.mockResolvedValue({ items: [], totalPages: 1 });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <ScansHistoryPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/no scan logs match the current filters/i),
      ).toBeInTheDocument();
    });
  });
});

describe("ScansHistoryPage — error state with retry (Requirements 3.6, 3.7)", () => {
  it("renders an error state when the scan query fails", async () => {
    getMock.mockRejectedValue(new Error("Network error"));

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <ScansHistoryPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load scan history/i),
      ).toBeInTheDocument();
    });
  });

  it("displays a retry button in the error state", async () => {
    getMock.mockRejectedValue(new Error("Network error"));

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <ScansHistoryPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  it("retries the query when the retry button is clicked", async () => {
    getMock.mockRejectedValueOnce(new Error("Network error"));

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <ScansHistoryPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    // Now make the next call succeed
    getMock.mockResolvedValue({ items: [], totalPages: 1 });

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/no scan logs match the current filters/i),
      ).toBeInTheDocument();
    });
  });
});
