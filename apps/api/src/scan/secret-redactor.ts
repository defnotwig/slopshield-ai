/**
 * Secret redaction + prompt-injection neutralization for repository content
 * sent to the AI reviewer.
 *
 * Repository content fetched from GitHub is **untrusted data**. Before it is
 * forwarded to the AI provider for the ai-reviewing stage, this module:
 *
 *  1. Redacts detected secret VALUES (API keys, tokens, passwords, private
 *     keys, connection strings, etc.) — replacing them with a fixed
 *     {@link REDACTED_TOKEN} so credentials never leak to the AI provider
 *     (Requirement 10.1).
 *  2. Neutralizes instruction-like content so comments or text inside the
 *     repository cannot override the reviewer or system instructions — i.e.
 *     prompt-injection defanging (Requirement 10.2).
 *
 * The secret regex set mirrors the one used by `SecretAnalyzer`
 * (`packages/scanner-plugins/src/analyzers/secret.analyzer.ts`). It is copied
 * here intentionally: redaction must stay decoupled from the analyzer's
 * file-scanning concerns, and a copied, self-contained pattern list keeps this
 * utility a pure, dependency-free string transform that is trivial to test.
 *
 * Both transforms are always safe to apply, so the pipeline can run them for
 * every source type without source-type-specific branching (Requirement 5.2).
 */

/** Fixed token that replaces every detected secret value. */
export const REDACTED_TOKEN = "***REDACTED***";

/** Marker wrapped around defanged prompt-injection phrases. */
export const NEUTRALIZED_TOKEN = "[neutralized-instruction]";

/**
 * Secret detection patterns reused from `SecretAnalyzer`.
 *
 * `valueGroup` indicates which capture group holds the sensitive value to
 * redact. When `0`, the entire match is the secret and is replaced wholesale;
 * when `1`, only the captured value (e.g. the quoted string after `apiKey=`)
 * is replaced, preserving the surrounding key/assignment context.
 *
 * All regexes are declared with the `g` (and `i` where the source uses it)
 * flags so that every occurrence in the content is redacted.
 */
interface SecretPattern {
  name: string;
  regex: RegExp;
  valueGroup: 0 | 1;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "AWS Access Key",
    regex: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g,
    valueGroup: 0,
  },
  {
    name: "Generic API Key",
    regex:
      /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"]([a-zA-Z0-9_\-]{16,})['"]/gi,
    valueGroup: 1,
  },
  {
    name: "Generic Password",
    regex: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
    valueGroup: 1,
  },
  {
    name: "Generic Token",
    regex: /(?:token|bearer|auth)\s*[:=]\s*['"]([a-zA-Z0-9_\-.]{20,})['"]/gi,
    valueGroup: 1,
  },
  {
    name: "Connection String",
    regex: /(?:postgres|mysql|mongodb|redis):\/\/([^\s'"]+)/gi,
    valueGroup: 1,
  },
  {
    name: "Private Key",
    regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    valueGroup: 0,
  },
  {
    name: "JWT Token",
    regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    valueGroup: 0,
  },
  { name: "GitHub Token", regex: /gh[pousr]_[a-zA-Z0-9]{36,}/g, valueGroup: 0 },
  {
    name: "GitHub Fine-Grained Token",
    regex: /github_pat_[a-zA-Z0-9]{82}/g,
    valueGroup: 0,
  },
  { name: "Slack Token", regex: /xox[bpoas]-[a-zA-Z0-9-]+/g, valueGroup: 0 },
  {
    name: "Stripe API Key",
    regex: /rk_(?:live|test)_[0-9a-zA-Z]{24}|sk_(?:live|test)_[0-9a-zA-Z]{24}/g,
    valueGroup: 0,
  },
  {
    name: "Slack Webhook URL",
    regex:
      /https:\/\/hooks.slack.com\/services\/T[A-Za-z0-9_]{8}\/B[A-Za-z0-9_]{8}\/[A-Za-z0-9_]{24}/g,
    valueGroup: 0,
  },
  { name: "Google API Key", regex: /AIza[0-9A-Za-z-_]{35}/g, valueGroup: 0 },
  {
    name: "Heroku API Key",
    regex:
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
    valueGroup: 0,
  },
  {
    name: "Facebook Access Token",
    regex: /EAACEdEose0cBA[0-9A-Za-z]+/g,
    valueGroup: 0,
  },
  {
    name: "Twitter OAuth Secret",
    regex: /[tT][wW][iI][tT][tT][eE][rR].*[0-9a-zA-Z]{35,44}/g,
    valueGroup: 0,
  },
  { name: "Mailgun API Key", regex: /key-[0-9a-zA-Z]{32}/g, valueGroup: 0 },
  { name: "Twilio Account SID", regex: /AC[a-f0-9]{32}/g, valueGroup: 0 },
  { name: "Twilio Auth Token", regex: /SK[a-f0-9]{32}/g, valueGroup: 0 },
];

/**
 * Prompt-injection trigger phrases. Repository text containing these phrases
 * is treated as untrusted data and defanged so it cannot be interpreted as a
 * directive to the reviewer/system. Matching is case-insensitive and global.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all |any )?(?:the )?(?:previous|prior|preceding|above|earlier) (?:instructions?|prompts?|messages?|directions?|context)/gi,
  /disregard (?:all |any )?(?:the )?(?:previous|prior|preceding|above|earlier) (?:instructions?|prompts?|messages?|directions?|context)/gi,
  /forget (?:all |any )?(?:the )?(?:previous|prior|preceding|above|earlier) (?:instructions?|prompts?|messages?|directions?|context)/gi,
  /override (?:all |any )?(?:the )?(?:previous|prior|system) (?:instructions?|prompts?|rules?)/gi,
  /you are (?:now )?(?:a|an) (?:different|new) (?:ai|assistant|agent|model|system)/gi,
  /(?:new|updated|revised) (?:system )?(?:instructions?|prompts?|rules?)\s*:/gi,
  /system\s*(?:prompt|message|instruction)\s*:/gi,
  /(?:act|behave|respond) as (?:if you are |though you are )?(?:a |an )?(?:dan|jailbroken|unrestricted|uncensored)/gi,
  /developer mode/gi,
  /\bdo anything now\b/gi,
];

/**
 * Replace every secret value detected by the pattern set with
 * {@link REDACTED_TOKEN}. All occurrences are replaced (patterns are global).
 *
 * For patterns whose value lives in capture group 1, only the value portion is
 * replaced so the surrounding key/assignment context survives (which keeps the
 * redacted text readable for the AI reviewer); for full-match patterns the
 * whole match is replaced.
 */
function redactSecretValues(content: string): string {
  let result = content;
  for (const { regex, valueGroup } of SECRET_PATTERNS) {
    result = result.replace(regex, (match, group1?: string) => {
      if (valueGroup === 1 && typeof group1 === "string") {
        // Replace only the captured secret value within the full match.
        return match.replace(group1, REDACTED_TOKEN);
      }
      return REDACTED_TOKEN;
    });
  }
  return result;
}

/**
 * Defang prompt-injection trigger phrases by wrapping each match in a
 * {@link NEUTRALIZED_TOKEN} marker. The original (now-inert) words are kept
 * inside the marker so the AI reviewer can still see that injected text was
 * present without treating it as an instruction.
 */
function neutralizeInstructions(content: string): string {
  let result = content;
  for (const regex of INJECTION_PATTERNS) {
    result = result.replace(
      regex,
      (match) => `${NEUTRALIZED_TOKEN} ${match} ${NEUTRALIZED_TOKEN}`,
    );
  }
  return result;
}

/**
 * Sanitize untrusted repository content before it is sent to the AI reviewer.
 *
 * Applies, in order:
 *  1. Secret redaction — every detected secret value becomes {@link REDACTED_TOKEN}.
 *  2. Instruction neutralization — prompt-injection phrases are defanged.
 *
 * The function is a pure string transform: given the same input it always
 * returns the same output and has no side effects, making it safe to apply to
 * every file for every source type.
 *
 * @param content Raw file content from a (possibly untrusted) repository.
 * @returns The redacted, instruction-neutralized content.
 */
export function redactSecrets(content: string): string {
  if (!content) {
    return content;
  }
  const withoutSecrets = redactSecretValues(content);
  return neutralizeInstructions(withoutSecrets);
}
