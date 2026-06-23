/**
 * Unit tests for the FindingsTable filter + sort behavior over real findings.
 *
 * Covers:
 *  - Requirement 8.5: filtering and sorting are applied to the real findings
 *    of a scan (by severity, category, and free-text search).
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FindingsTable } from "./findings-table";

afterEach(() => {
  cleanup();
});

const findings = [
  {
    id: "f-info",
    filePath: "src/utils.ts",
    lineNumber: 10,
    severity: "info",
    category: "maintainability",
    title: "Magic number used",
    description: "Replace magic number with a named constant.",
    blocking: false,
    source: "eslint",
  },
  {
    id: "f-critical",
    filePath: "src/auth.ts",
    lineNumber: 42,
    severity: "critical",
    category: "security",
    title: "Hardcoded secret detected",
    description: "A credential is committed in source.",
    blocking: true,
    source: "secret-scanner",
  },
  {
    id: "f-medium",
    filePath: "src/ui/Button.tsx",
    lineNumber: 5,
    severity: "medium",
    category: "frontend",
    title: "Missing aria-label",
    description: "Interactive control lacks an accessible name.",
    blocking: false,
    source: "eslint",
  },
];

function getRowTitles(): string[] {
  const rows = screen.getAllByRole("row");
  // Drop the header row.
  return rows
    .slice(1)
    .map((r) => within(r).queryByRole("button", { name: /inspect/i }) && r)
    .filter((r): r is HTMLElement => Boolean(r))
    .map((r) => r.textContent || "");
}

describe("FindingsTable filtering (Requirement 8.5)", () => {
  it("renders all real findings by default", () => {
    render(<FindingsTable findings={findings} onSelectFinding={() => {}} />);
    expect(screen.getByText("Hardcoded secret detected")).toBeInTheDocument();
    expect(screen.getByText("Magic number used")).toBeInTheDocument();
    expect(screen.getByText("Missing aria-label")).toBeInTheDocument();
  });

  it("filters real findings by severity", () => {
    render(<FindingsTable findings={findings} onSelectFinding={() => {}} />);
    fireEvent.change(screen.getByLabelText(/sort findings by/i), {
      target: { value: "severity" },
    });
    // Severity select is the first <select> labeled by the Severity column.
    const selects = screen.getAllByRole("combobox");
    // selects: [severity, category, sortBy]
    fireEvent.change(selects[0], { target: { value: "critical" } });

    expect(screen.getByText("Hardcoded secret detected")).toBeInTheDocument();
    expect(screen.queryByText("Magic number used")).toBeNull();
    expect(screen.queryByText("Missing aria-label")).toBeNull();
  });

  it("filters real findings by free-text search on title and file", () => {
    render(<FindingsTable findings={findings} onSelectFinding={() => {}} />);
    fireEvent.change(
      screen.getByPlaceholderText(/search findings title or file/i),
      { target: { value: "aria" } },
    );
    expect(screen.getByText("Missing aria-label")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret detected")).toBeNull();
  });

  it("shows an empty message when no findings match the filter", () => {
    render(<FindingsTable findings={findings} onSelectFinding={() => {}} />);
    fireEvent.change(
      screen.getByPlaceholderText(/search findings title or file/i),
      { target: { value: "no-such-finding-xyz" } },
    );
    expect(
      screen.getByText(/no findings matches the active filter criteria/i),
    ).toBeInTheDocument();
  });
});

describe("FindingsTable sorting (Requirement 8.5)", () => {
  it("sorts by severity descending (most serious first) by default", () => {
    render(<FindingsTable findings={findings} onSelectFinding={() => {}} />);
    const titles = getRowTitles();
    const criticalIdx = titles.findIndex((t) =>
      t.includes("Hardcoded secret detected"),
    );
    const mediumIdx = titles.findIndex((t) => t.includes("Missing aria-label"));
    const infoIdx = titles.findIndex((t) => t.includes("Magic number used"));
    expect(criticalIdx).toBeLessThan(mediumIdx);
    expect(mediumIdx).toBeLessThan(infoIdx);
  });

  it("reverses ordering when sort direction is toggled to ascending", () => {
    render(<FindingsTable findings={findings} onSelectFinding={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /toggle sort direction/i }));
    const titles = getRowTitles();
    const criticalIdx = titles.findIndex((t) =>
      t.includes("Hardcoded secret detected"),
    );
    const infoIdx = titles.findIndex((t) => t.includes("Magic number used"));
    expect(infoIdx).toBeLessThan(criticalIdx);
  });

  it("sorts by title alphabetically when selected", () => {
    render(<FindingsTable findings={findings} onSelectFinding={() => {}} />);
    fireEvent.change(screen.getByLabelText(/sort findings by/i), {
      target: { value: "title" },
    });
    fireEvent.click(screen.getByRole("button", { name: /toggle sort direction/i }));
    const titles = getRowTitles();
    const hardcodedIdx = titles.findIndex((t) =>
      t.includes("Hardcoded secret detected"),
    );
    const magicIdx = titles.findIndex((t) => t.includes("Magic number used"));
    const missingIdx = titles.findIndex((t) => t.includes("Missing aria-label"));
    // Ascending alphabetical: Hardcoded < Magic < Missing
    expect(hardcodedIdx).toBeLessThan(magicIdx);
    expect(magicIdx).toBeLessThan(missingIdx);
  });
});
