import { FindingCategory } from "../schemas/finding.schema.js";

export interface AutoBlockCondition {
  id: string;
  title: string;
  description: string;
  category: FindingCategory;
}

/**
 * Core conditions that trigger an automatic blocking verdict for a scan.
 * If any finding matching these rules or properties is detected, the scan is blocked,
 * regardless of whether the overall score is above the project threshold.
 */
export const AUTO_BLOCK_CONDITIONS: AutoBlockCondition[] = [
  {
    id: "detected-secret",
    title: "Detected Secret or Credential",
    description:
      "Unencrypted passwords, API keys, tokens, or private keys embedded directly in source code.",
    category: "backend-security",
  },
  {
    id: "missing-authorization",
    title: "Missing Authorization on Protected Endpoint",
    description:
      "Exposing sensitive backend routes or controllers without appropriate guards or auth middleware.",
    category: "backend-security",
  },
  {
    id: "sql-injection",
    title: "SQL Injection Risk",
    description:
      "Constructing dynamic database queries from untrusted input without parameterized statements or ORMs.",
    category: "backend-security",
  },
  {
    id: "html-injection",
    title: "Dangerous Frontend HTML Injection",
    description:
      "Injecting raw user input directly into the DOM via dangerouslySetInnerHTML or innerHTML without sanitization.",
    category: "frontend-security",
  },
  {
    id: "vulnerable-dependency",
    title: "Critical Vulnerable Dependency",
    description:
      "Using dependencies with published critical-severity vulnerabilities (e.g. CVSS >= 9.0).",
    category: "backend-security",
  },
  {
    id: "no-tests-high-risk",
    title: "No Tests for High-Risk Change",
    description:
      "Modifying core transaction, auth, or payment modules without adding or modifying test suites.",
    category: "testability",
  },
  {
    id: "broken-architecture",
    title: "Broken Architecture Boundary",
    description:
      "Violating strict project boundaries, such as importing database models or secrets directly inside the client layer.",
    category: "backend-architecture",
  },
  {
    id: "unsafe-file-upload",
    title: "Unsafe File Upload Handling",
    description:
      "Accepting client-uploaded files without validation of file extension, MIME type, or storage boundaries.",
    category: "backend-security",
  },
  {
    id: "data-exposure",
    title: "Public Exposure of Sensitive Data",
    description:
      "Returning sensitive database fields (like passwords or PII) directly in API JSON responses.",
    category: "backend-security",
  },
];
