/**
 * BTS-62 — the post-checkout redirect URL for embedded Stripe Checkout.
 *
 * `{CHECKOUT_SESSION_ID}` is Stripe's own placeholder token: Checkout
 * substitutes it with the real `cs_…` id and navigates the browser to
 * `return_url` itself once payment completes. There is no separate app-side
 * redirect to write — `EmbeddedCheckout`'s `onComplete` callback receives no
 * session id and fires (if at all) after Stripe's own redirect has already
 * navigated away, so it must not attempt its own navigation.
 */
export function buildCheckoutReturnUrl(origin: string): string {
  return `${origin}/checkout/status?session_id={CHECKOUT_SESSION_ID}`;
}
