/**
 * Statement-descriptor suffix rules (BTS-32).
 *
 * On destination charges the platform is the merchant of record, so per-store
 * buyer recognition is suffix-based: Stripe renders `PREFIX* SUFFIX` from the
 * platform account's shortened descriptor plus a per-charge suffix. Stripe's
 * rules (docs.stripe.com/get-started/account/statement-descriptors): Latin
 * characters only, at least one letter, none of < > \ ' " *, and the complete
 * descriptor is capped at 22 characters.
 */

export const STATEMENT_DESCRIPTOR_MAX_LENGTH = 22;

const DISALLOWED_CHARS = /[<>\\'"*]/;
const HAS_LETTER = /[a-zA-Z]/;
const NON_ASCII = /[^\x20-\x7E]/;

function fail(message: string): never {
  throw new Error(`Invalid statement descriptor suffix: ${message}`);
}

/**
 * Validate a per-store statement-descriptor suffix against Stripe's rules and
 * return the trimmed value. Throws on violations rather than truncating —
 * silently mangling what a buyer sees on their card statement defeats the
 * point of the descriptor (charge recognition).
 *
 * Note: Stripe caps the COMPLETE descriptor (account prefix + `* ` + suffix)
 * at 22 characters and truncates the overflow itself; the library can't know
 * the platform's prefix length, so it enforces the 22-character cap on the
 * suffix alone. Keep suffixes comfortably short of the cap for full display.
 */
export function validateStatementDescriptorSuffix(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) fail("must not be empty");
  if (trimmed.length > STATEMENT_DESCRIPTOR_MAX_LENGTH) {
    fail(
      `must be at most ${STATEMENT_DESCRIPTOR_MAX_LENGTH} characters, got ${trimmed.length}`,
    );
  }
  if (DISALLOWED_CHARS.test(trimmed) || NON_ASCII.test(trimmed)) {
    fail(`contains a disallowed character (no < > \\ ' " * or non-Latin)`);
  }
  if (!HAS_LETTER.test(trimmed)) fail("must contain at least one letter");
  return trimmed;
}
