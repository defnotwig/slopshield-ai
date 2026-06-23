/**
 * Returns true if the email is a synthetic placeholder generated
 * during Lark user creation (e.g., lark_abc123@slopshield.local).
 */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  return email.endsWith("@slopshield.local");
}
