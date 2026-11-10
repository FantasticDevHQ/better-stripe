/**
 * Which `.env.local` values the setup script copies into the Convex
 * deployment. Kept pure (no CLI or dotenv access) so it is unit-testable.
 *
 * `STRIPE_SECRET_KEY` is required by the caller; `STRIPE_PUBLISHABLE_KEY` is
 * optional and skipped when blank. Both live in Convex: the browser reads the
 * publishable key through `stripe/public/queries:getPublishableKey`.
 */
export const SETUP_ENV_VAR_NAMES = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
] as const;

export function convexEnvVarsToSet(
  source: Record<string, string | undefined>,
): { name: (typeof SETUP_ENV_VAR_NAMES)[number]; value: string }[] {
  return SETUP_ENV_VAR_NAMES.flatMap((name) => {
    const value = source[name]?.trim();
    return value ? [{ name, value }] : [];
  });
}
