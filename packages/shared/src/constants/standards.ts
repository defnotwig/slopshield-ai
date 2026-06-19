export interface StandardReference {
  id: string;
  name: string;
  shortName: string;
  url: string;
  description: string;
}

/**
 * Official compliance and software quality standards mapped by findings.
 */
export const STANDARDS_REFERENCES: Record<string, StandardReference> = {
  OWASP_TOP_10: {
    id: 'OWASP_TOP_10',
    name: 'OWASP Top 10 Web Application Security Risks',
    shortName: 'OWASP Top 10',
    url: 'https://owasp.org/www-project-top-ten/',
    description: 'Standard awareness document for web application security risks representing broad consensus.',
  },
  OWASP_API_TOP_10: {
    id: 'OWASP_API_TOP_10',
    name: 'OWASP API Security Top 10',
    shortName: 'OWASP API Top 10',
    url: 'https://owasp.org/www-project-api-security/',
    description: 'Security risks specific to APIs, covering authorization, rate limits, and injection flaws.',
  },
  OWASP_ASVS: {
    id: 'OWASP_ASVS',
    name: 'OWASP Application Security Verification Standard',
    shortName: 'OWASP ASVS',
    url: 'https://owasp.org/www-project-application-security-verification-standard/',
    description: 'A framework of security requirements and controls for testing web applications.',
  },
  CWE_TOP_25: {
    id: 'CWE_TOP_25',
    name: 'CWE Top 25 Most Dangerous Software Weaknesses',
    shortName: 'CWE Top 25',
    url: 'https://cwe.mitre.org/top25/',
    description: 'A list of the most widespread and critical software weaknesses that can lead to vulnerabilities.',
  },
  NIST_SSDF: {
    id: 'NIST_SSDF',
    name: 'NIST Secure Software Development Framework (SP 800-218)',
    shortName: 'NIST SSDF',
    url: 'https://csrc.nist.gov/projects/ssdf',
    description: 'Guidelines for security-focused software development lifecycle practices.',
  },
  ISO_25010: {
    id: 'ISO_25010',
    name: 'ISO/IEC 25010 Systems and Software Quality Models',
    shortName: 'ISO 25010',
    url: 'https://iso25000.com/index.php/en/iso-25000-standards/iso-25010',
    description: 'International standard defining system and software quality characteristics.',
  },
  WCAG_22: {
    id: 'WCAG_22',
    name: 'Web Content Accessibility Guidelines 2.2',
    shortName: 'WCAG 2.2',
    url: 'https://www.w3.org/TR/WCAG22/',
    description: 'Guidelines to make web content more accessible to people with disabilities.',
  },
  CLEAN_CODE: {
    id: 'CLEAN_CODE',
    name: 'Clean Code: A Handbook of Agile Software Craftsmanship',
    shortName: 'Clean Code',
    url: 'https://www.oreilly.com/library/view/clean-code-a/9780136083238/',
    description: 'Principles for writing readable, maintainable, and refactor-friendly code.',
  },
  PRAGMATIC_PROGRAMMER: {
    id: 'PRAGMATIC_PROGRAMMER',
    name: 'The Pragmatic Programmer: Your Journey to Mastery',
    shortName: 'Pragmatic Programmer',
    url: 'https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/',
    description: 'Best practices for software construction, design patterns, and self-organization.',
  },
  REFACTORING: {
    id: 'REFACTORING',
    name: 'Refactoring: Improving the Design of Existing Code',
    shortName: 'Refactoring',
    url: 'https://martinfowler.com/books/refactoring.html',
    description: 'Structured techniques to improve internal code structure without changing external behavior.',
  },
  PHILOSOPHY_SOFTWARE_DESIGN: {
    id: 'PHILOSOPHY_SOFTWARE_DESIGN',
    name: 'A Philosophy of Software Design by John Ousterhout',
    shortName: 'Philosophy of Software Design',
    url: 'https://www.amazon.com/Philosophy-Software-Design-John-Ousterhout/dp/1732102201',
    description: 'Concepts on reducing complexity in software design and managing module boundaries.',
  },
  CODE_COMPLETE: {
    id: 'CODE_COMPLETE',
    name: 'Code Complete: A Practical Handbook of Software Construction',
    shortName: 'Code Complete',
    url: 'https://learn.microsoft.com/en-us/archive/blogs/microsoft_press/code-complete-2nd-edition',
    description: 'Exhaustive guide on software building, coding style, naming conventions, and validation.',
  },
};
