import { StandardsMapper } from "./standards-mapper";

describe("StandardsMapper.mapFindingToStandards (standards category rules)", () => {
  let mapper: StandardsMapper;

  beforeEach(() => {
    mapper = new StandardsMapper();
  });

  // Requirement 6.2: secret / credential findings map to security standards
  it("maps a secret/credential security finding to CWE_TOP_25 and NIST_SSDF", () => {
    const result = mapper.mapFindingToStandards({
      title: "Hardcoded secret credential exposed",
      category: "security",
      description: "A secret token is stored in plaintext",
    });

    expect(result).toEqual(expect.arrayContaining(["CWE_TOP_25", "NIST_SSDF"]));
  });

  // Requirement 6.3: injection / SQL findings map to injection standards
  it("maps an SQL injection security finding to OWASP_TOP_10 and CWE_TOP_25", () => {
    const result = mapper.mapFindingToStandards({
      title: "SQL injection vulnerability",
      category: "security",
      description: "Unsanitized input concatenated into a SQL query",
    });

    expect(result).toEqual(
      expect.arrayContaining(["OWASP_TOP_10", "CWE_TOP_25"]),
    );
  });

  // Requirement 6.4: access-control / auth findings map to access control standards
  it("maps an access-control/auth security finding to OWASP_TOP_10 and OWASP_API_TOP_10", () => {
    const result = mapper.mapFindingToStandards({
      title: "Missing authorization guard",
      category: "security",
      description: "Endpoint lacks an auth permission check",
    });

    expect(result).toEqual(
      expect.arrayContaining(["OWASP_TOP_10", "OWASP_API_TOP_10"]),
    );
  });

  // Requirement 6.5: accessibility findings map to accessibility standards
  it("maps an accessibility finding to WCAG_22 and ISO_25010", () => {
    const result = mapper.mapFindingToStandards({
      title: "Image missing alt text",
      category: "accessibility",
      description: "Missing aria-label on interactive control",
    });

    expect(result).toEqual(expect.arrayContaining(["WCAG_22", "ISO_25010"]));
  });

  // Requirement 6.6: maintainability findings map to quality / craftsmanship standards
  it("maps a maintainability finding to ISO_25010 and craftsmanship refs like CLEAN_CODE", () => {
    const result = mapper.mapFindingToStandards({
      title: "Overly complex duplicated logic",
      category: "maintainability",
      description: "Unclear naming and duplicate code blocks",
    });

    expect(result).toEqual(expect.arrayContaining(["ISO_25010", "CLEAN_CODE"]));
  });
});
