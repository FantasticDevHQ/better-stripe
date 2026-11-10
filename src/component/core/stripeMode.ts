/** Secret/restricted key prefixes Stripe issues for test mode and sandboxes. */
const TEST_MODE_KEY_PREFIXES = ["sk_test_", "rk_test_"] as const;

export function isTestModeSecretKey(key: string | undefined): boolean {
  return (
    typeof key === "string" &&
    TEST_MODE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * Refuse a destructive operation unless the component's `STRIPE_SECRET_KEY`
 * is provably a test-mode key. A missing key is refused too: absence of
 * evidence is not evidence of a test deployment.
 */
export function assertTestModeForReset(operation: string): void {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      `${operation} refused: STRIPE_SECRET_KEY is not set for the component, ` +
        "so test mode cannot be confirmed.",
    );
  }
  if (!isTestModeSecretKey(key)) {
    throw new Error(
      `${operation} refused: STRIPE_SECRET_KEY is not a test-mode key ` +
        "(expected an sk_test_ or rk_test_ prefix). Resets never run against live mode.",
    );
  }
}
