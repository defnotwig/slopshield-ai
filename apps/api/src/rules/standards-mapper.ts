import { Injectable } from "@nestjs/common";
import { STANDARDS_REFERENCES } from "@slopshield/shared";

@Injectable()
export class StandardsMapper {
  /**
   * Documented fallback Standard_Reference (Requirement 6.7).
   *
   * ISO/IEC 25010 is the broadest software-quality model in
   * `STANDARDS_REFERENCES` and is applicable to any finding category
   * (security, accessibility, architecture, maintainability, testability,
   * reliability, etc.). It is used whenever no more specific standard
   * matches, guaranteeing that every finding carries at least one valid
   * reference.
   */
  private static readonly FALLBACK_STANDARD = "ISO_25010";

  /**
   * Evaluates a finding to map it to corresponding security / quality standards.
   * Modifies standardReferences array in-place or returns a list of matched standard IDs.
   *
   * @param finding The finding to evaluate
   * @returns Array of standard references IDs (e.g. ['OWASP_TOP_10', 'CWE_TOP_25'])
   */
  public mapFindingToStandards(finding: {
    title: string;
    category: string;
    description?: string;
  }): string[] {
    const matchedStandards = new Set<string>();
    const textToSearch =
      `${finding.title} ${finding.description || ""}`.toLowerCase();

    // Security standards checks
    if (finding.category.includes("security")) {
      matchedStandards.add("NIST_SSDF");

      if (
        textToSearch.includes("key") ||
        textToSearch.includes("password") ||
        textToSearch.includes("secret") ||
        textToSearch.includes("token") ||
        textToSearch.includes("credential")
      ) {
        matchedStandards.add("CWE_TOP_25");
        matchedStandards.add("OWASP_TOP_10"); // A07:2021 Identification and Authentication Failures
      }

      if (
        textToSearch.includes("sql") ||
        textToSearch.includes("injection") ||
        textToSearch.includes("query")
      ) {
        matchedStandards.add("OWASP_TOP_10"); // A03:2021 Injection
        matchedStandards.add("OWASP_API_TOP_10"); // API8:2023 Security Misconfiguration / Injection
        matchedStandards.add("CWE_TOP_25");
      }

      if (
        textToSearch.includes("xss") ||
        textToSearch.includes("html") ||
        textToSearch.includes("dangerouslysetinnerhtml") ||
        textToSearch.includes("script")
      ) {
        matchedStandards.add("OWASP_TOP_10"); // A03:2021 Injection
        matchedStandards.add("CWE_TOP_25");
      }

      if (
        textToSearch.includes("auth") ||
        textToSearch.includes("permission") ||
        textToSearch.includes("guard") ||
        textToSearch.includes("roles")
      ) {
        matchedStandards.add("OWASP_TOP_10"); // A01:2021 Broken Access Control
        matchedStandards.add("OWASP_API_TOP_10"); // API1:2023 Broken Object Level Authorization
        matchedStandards.add("OWASP_ASVS");
      }

      if (textToSearch.includes("upload") || textToSearch.includes("file")) {
        matchedStandards.add("OWASP_ASVS");
        matchedStandards.add("OWASP_TOP_10");
      }

      // Default security fallback
      if (matchedStandards.size === 1) {
        matchedStandards.add("OWASP_TOP_10");
        matchedStandards.add("CWE_TOP_25");
      }
    }

    // Accessibility standard checks
    if (
      finding.category.includes("accessibility") ||
      textToSearch.includes("a11y") ||
      textToSearch.includes("aria") ||
      textToSearch.includes("alt") ||
      textToSearch.includes("label")
    ) {
      matchedStandards.add("WCAG_22");
      matchedStandards.add("ISO_25010");
    }

    // Architecture standard checks
    if (
      finding.category.includes("architecture") ||
      textToSearch.includes("import") ||
      textToSearch.includes("module") ||
      textToSearch.includes("coupling") ||
      textToSearch.includes("boundary")
    ) {
      matchedStandards.add("ISO_25010");
      matchedStandards.add("PHILOSOPHY_SOFTWARE_DESIGN");
      matchedStandards.add("CODE_COMPLETE");
    }

    // Maintainability standard checks
    if (
      finding.category.includes("maintainability") ||
      textToSearch.includes("naming") ||
      textToSearch.includes("clean") ||
      textToSearch.includes("complex") ||
      textToSearch.includes("duplicate")
    ) {
      matchedStandards.add("CLEAN_CODE");
      matchedStandards.add("PRAGMATIC_PROGRAMMER");
      matchedStandards.add("CODE_COMPLETE");
      matchedStandards.add("ISO_25010");
    }

    // Testability checks
    if (
      finding.category.includes("testability") ||
      textToSearch.includes("coverage") ||
      textToSearch.includes("mock") ||
      textToSearch.includes("test")
    ) {
      matchedStandards.add("CLEAN_CODE");
      matchedStandards.add("CODE_COMPLETE");
      matchedStandards.add("ISO_25010");
    }

    // Reliability checks
    if (
      finding.category.includes("reliability") ||
      textToSearch.includes("exception") ||
      textToSearch.includes("retry") ||
      textToSearch.includes("circuit") ||
      textToSearch.includes("timeout") ||
      textToSearch.includes("catch")
    ) {
      matchedStandards.add("ISO_25010");
      matchedStandards.add("PRAGMATIC_PROGRAMMER");
      matchedStandards.add("CODE_COMPLETE");
    }

    // Documented fallback (Requirement 6.7): if no specific category rule
    // matched, assign the general software-quality reference so that every
    // finding carries at least one valid STANDARDS_REFERENCES key.
    if (matchedStandards.size === 0) {
      matchedStandards.add(StandardsMapper.FALLBACK_STANDARD);
    }

    // Defensive guarantee: only emit keys that actually exist in
    // STANDARDS_REFERENCES, and never return an empty array. If filtering
    // ever removes everything, fall back to the documented reference.
    const validReferences = Array.from(matchedStandards).filter(
      (key) => key in STANDARDS_REFERENCES,
    );

    if (validReferences.length === 0) {
      validReferences.push(StandardsMapper.FALLBACK_STANDARD);
    }

    return validReferences;
  }
}
