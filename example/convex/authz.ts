/**
 * Demo authorization helpers (BTS-83).
 *
 * This example has no real authentication — the client just claims a
 * `userId` (a demo persona picked in the UI, see `useRole()`). Nothing
 * cryptographically proves the request came from that persona. What every
 * state-changing action CAN enforce is a BINDING: whatever resource the
 * caller is trying to act on must be server-verified as actually belonging
 * to the persona they claim to be, before any Stripe side effect runs. That
 * binding — not authentication — is what "ownership" means throughout this
 * file. See example/README.md → "Demo security model".
 *
 * `assertOwnership` is the single generic gate; each `assert*Owner` helper
 * below supplies the resource-specific lookup (subscription.userId is a
 * direct match, money/dispute flows resolve the actor's own connected
 * account first and then match it against the resource's owning account).
 */
import type { ActionCtx } from "./_generated/server";
import { components } from "./_generated/api";
import { stripe } from "./stripe";

function requireNonBlank(value: string, label: string): string {
  if (!value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value;
}

/**
 * Generic ownership gate for every state-changing example action.
 * `loadOwnedResource` resolves AND verifies ownership together — return the
 * resource only when `actorId` is its confirmed owner, or `null` otherwise.
 * Not-found and wrong-owner deliberately collapse into the same rejection so
 * a caller can't use the error to probe which resource ids exist.
 */
export async function assertOwnership<T>(
  ctx: ActionCtx,
  actorId: string,
  loadOwnedResource: (ctx: ActionCtx, actorId: string) => Promise<T | null>,
  notFoundMessage: string,
): Promise<T> {
  requireNonBlank(actorId, "actorId");
  const resource = await loadOwnedResource(ctx, actorId);
  if (!resource) {
    throw new Error(notFoundMessage);
  }
  return resource;
}

// =============================================================================
// Subscriptions (BTS-81, generalized here)
// =============================================================================

export async function assertSubscriptionOwner(
  ctx: ActionCtx,
  args: { userId: string; stripeSubscriptionId: string },
): Promise<{ userId: string; stripeSubscriptionId: string }> {
  const userId = requireNonBlank(args.userId, "userId");
  const stripeSubscriptionId = requireNonBlank(
    args.stripeSubscriptionId,
    "stripeSubscriptionId",
  );

  await assertOwnership(
    ctx,
    userId,
    async (ctx, actorId) => {
      const subscription = await stripe.getSubscriptionByStripeId(ctx, {
        stripeSubscriptionId,
      });
      return subscription && subscription.userId === actorId
        ? subscription
        : null;
    },
    "Subscription not found for this user",
  );

  return { userId, stripeSubscriptionId };
}

// =============================================================================
// Seller accounts — the identity binding money/dispute actions build on
// =============================================================================

/**
 * Verify that `userId` is genuinely linked to `stripeAccountId` — the
 * binding every money/dispute action needs before trusting a client-claimed
 * connected account. Returns the verified account.
 */
export async function assertAccountOwner(
  ctx: ActionCtx,
  args: { userId: string; stripeAccountId: string },
) {
  const userId = requireNonBlank(args.userId, "userId");
  const stripeAccountId = requireNonBlank(args.stripeAccountId, "stripeAccountId");

  return assertOwnership(
    ctx,
    userId,
    async (ctx, actorId) => {
      const account = await stripe.getAccountByUserId(ctx, { userId: actorId });
      return account && account.stripeAccountId === stripeAccountId
        ? account
        : null;
    },
    "Account not found for this user",
  );
}

// =============================================================================
// Disputes — owning account is the dispute's own `accountId` (BTS-83)
// =============================================================================

export async function assertDisputeOwner(
  ctx: ActionCtx,
  args: { userId: string; stripeDisputeId: string },
) {
  const userId = requireNonBlank(args.userId, "userId");
  const stripeDisputeId = requireNonBlank(args.stripeDisputeId, "stripeDisputeId");

  return assertOwnership(
    ctx,
    userId,
    async (ctx, actorId) => {
      const account = await stripe.getAccountByUserId(ctx, { userId: actorId });
      if (!account?.stripeAccountId) return null;
      const dispute = await stripe.getDisputeByStripeId(ctx, { stripeDisputeId });
      return dispute && dispute.accountId === account.stripeAccountId
        ? dispute
        : null;
    },
    "Dispute not found for this account",
  );
}

// =============================================================================
// Payments / refunds — owning account is the sale's merchant leg (BTS-83)
// =============================================================================

const connectQueries = components.betterStripe.connect.queries;

type PaymentRoutingRow = {
  destinationAccountId?: string;
  splitRecipients?: readonly { role: string; destinationAccountId: string }[];
};

/**
 * Whether `stripeAccountId` is the merchant of a sale: the destination of a
 * destination charge, or the `store` leg of a split (separate-charges) sale.
 * Mirrors the library's own seller-refund scoping (`isRefundAuthorized`,
 * BTS-35) — minor split legs (affiliate/other) never qualify.
 */
function isMerchantOfSale(
  payment: PaymentRoutingRow,
  stripeAccountId: string,
): boolean {
  if (payment.destinationAccountId === stripeAccountId) return true;
  return (payment.splitRecipients ?? []).some(
    (r) => r.role === "store" && r.destinationAccountId === stripeAccountId,
  );
}

export async function assertPaymentOwner(
  ctx: ActionCtx,
  args: { userId: string; stripePaymentIntentId: string },
) {
  const userId = requireNonBlank(args.userId, "userId");
  const stripePaymentIntentId = requireNonBlank(
    args.stripePaymentIntentId,
    "stripePaymentIntentId",
  );

  return assertOwnership(
    ctx,
    userId,
    async (ctx, actorId) => {
      const account = await stripe.getAccountByUserId(ctx, { userId: actorId });
      if (!account?.stripeAccountId) return null;
      const payment = (await ctx.runQuery(connectQueries.getPaymentByStripeId, {
        stripePaymentIntentId,
      })) as PaymentRoutingRow | null;
      return payment && isMerchantOfSale(payment, account.stripeAccountId)
        ? account
        : null;
    },
    "Payment not found for this account",
  );
}

// =============================================================================
// Transfers / reversals — owning account is the charge's merchant leg
// =============================================================================

type TransferRoutingRow = { destinationAccountId: string; role?: string };

export async function assertTransfersOwner(
  ctx: ActionCtx,
  args: { userId: string; sourceChargeId: string },
) {
  const userId = requireNonBlank(args.userId, "userId");
  const sourceChargeId = requireNonBlank(args.sourceChargeId, "sourceChargeId");

  return assertOwnership(
    ctx,
    userId,
    async (ctx, actorId) => {
      const account = await stripe.getAccountByUserId(ctx, { userId: actorId });
      if (!account?.stripeAccountId) return null;
      const transfers = (await stripe.listTransfersByCharge(ctx, {
        sourceChargeId,
      })) as TransferRoutingRow[];
      const ownsMerchantLeg = transfers.some(
        (t) =>
          t.destinationAccountId === account.stripeAccountId &&
          (t.role === undefined || t.role === "store"),
      );
      return ownsMerchantLeg ? account : null;
    },
    "Charge not found for this account",
  );
}

// =============================================================================
// Prices — a price has no owner of its own; ownership is the owning product's
// connected account (BTS-88)
// =============================================================================

/**
 * Verify `userId` owns the price's owning product. A `prices` row carries no
 * owner field — only its `stripeProductId` — so ownership resolves one hop up:
 * the price's product must carry an `accountId` equal to the caller's own
 * connected account (`getAccountByUserId`). This mirrors `assertPaymentOwner`'s
 * resolve-the-actor's-account-then-match shape. A missing price, a missing or
 * orphaned product, a platform-catalog product (created with no `accountId`),
 * or an account mismatch all collapse into the same rejection so a caller can't
 * probe which price/product ids exist. Returns the verified account.
 */
export async function assertPriceOwner(
  ctx: ActionCtx,
  args: { userId: string; stripePriceId: string },
) {
  const userId = requireNonBlank(args.userId, "userId");
  const stripePriceId = requireNonBlank(args.stripePriceId, "stripePriceId");

  return assertOwnership(
    ctx,
    userId,
    async (ctx, actorId) => {
      const account = await stripe.getAccountByUserId(ctx, { userId: actorId });
      if (!account?.stripeAccountId) return null;
      const price = await stripe.getPriceByStripeId(ctx, { stripePriceId });
      if (!price) return null;
      const product = await stripe.getProductByStripeId(ctx, {
        stripeProductId: price.stripeProductId,
      });
      return product && product.accountId === account.stripeAccountId
        ? account
        : null;
    },
    "Price not found for this account",
  );
}

// =============================================================================
// Test-mode money guard (BTS-77, shared here for BTS-83)
// =============================================================================

/**
 * Fail-closed guard against running a real-money/dispute-closing action with
 * a non-test-mode key. Every action that calls this makes a REAL Stripe API
 * call — if `STRIPE_SECRET_KEY` were ever a live key, clicking a demo button
 * would move real money. Test (and restricted-test) secret keys are always
 * prefixed `sk_test_`/`rk_test_`; anything else — missing, live, or
 * malformed — throws. Originally introduced for the admin Testing page
 * (BTS-77, still re-exported from `./adminTesting` for that page's own
 * imports/tests); shared here so `issueRefund`/`reverseSaleTransfers`/
 * `acceptDispute` get the identical guard (BTS-83).
 */
export function assertTestModeStripeKey(key: string | undefined): void {
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY not set on the deployment");
  }
  if (!/^[rs]k_test_/.test(key)) {
    throw new Error(
      "Refusing to fire an admin test trigger: STRIPE_SECRET_KEY is not a " +
        "test-mode key (expected an sk_test_/rk_test_ prefix). This page " +
        "makes REAL Stripe API calls and must never run against a live key.",
    );
  }
}
