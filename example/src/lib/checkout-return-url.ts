/**
 * BTS-62 — the post-checkout redirect URL for embedded Stripe Checkout.
 *
 * `{CHECKOUT_SESSION_ID}` is Stripe's own placeholder token: Checkout
 * substitutes it with the real `cs_…` id and navigates the browser to
 * `return_url` itself once payment completes. There is no separate app-side
 * redirect to write — `EmbeddedCheckout`'s `onComplete` callback receives no
 * session id and fires (if at all) after Stripe's own redirect has already
 * navigated away, so it must not attempt its own navigation.
 *
 * `path` defaults to the generic `/checkout/status` landing page (BTS-57/62);
 * pass a different path for a demo page that reads its own `session_id`
 * param to confirm completion inline (BTS-58) instead of redirecting away.
 */
export function buildCheckoutReturnUrl(
  origin: string,
  path = "/checkout/status",
): string {
  return `${origin}${path}?session_id={CHECKOUT_SESSION_ID}`;
}
