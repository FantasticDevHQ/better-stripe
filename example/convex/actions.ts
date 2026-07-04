import { v } from "convex/values";

import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { stripe } from "./stripe";
import { DEMO_SALE_AMOUNT, buildSplitRecipients } from "./affiliateSplit";

// Webhook setup — creates both V1 (snapshot) and V2 (thin) event destinations
export const setupWebhooks = action({
  args: { siteUrl: v.string() },
  handler: async (ctx, args) => {
    const webhookUrl = `${args.siteUrl}/stripe/webhook`;

    // 1. Ensure V1 snapshot destination exists (payments, subscriptions, etc.)
    const v1 = await stripe.setupEventDestination(ctx, {
      url: webhookUrl,
      eventPayload: "snapshot",
    });

    // 2. Ensure V2 thin destination exists (Connect account lifecycle)
    const v2 = await stripe.setupEventDestination(ctx, {
      url: webhookUrl,
      eventPayload: "thin",
    });

    return { v1, v2 };
  },
});

export const getWebhookStatus = action({
  args: { siteUrl: v.string() },
  handler: async (ctx, args) => {
    const webhookUrl = `${args.siteUrl}/stripe/webhook`;
    const destinations = await stripe.listEventDestinations(ctx);

    const v1Match = destinations.find(
      (d) => d.url === webhookUrl && d.eventPayload === "snapshot",
    );
    const v2Match = destinations.find(
      (d) => d.url === webhookUrl && d.eventPayload === "thin",
    );

    return {
      v1: v1Match
        ? {
            id: v1Match.id,
            name: v1Match.name,
            status: v1Match.status,
            eventCount: v1Match.enabledEvents.length,
          }
        : null,
      v2: v2Match
        ? {
            id: v2Match.id,
            name: v2Match.name,
            status: v2Match.status,
            eventCount: v2Match.enabledEvents.length,
          }
        : null,
    };
  },
});

export const verifyWebhookEnvs = action({
  args: {},
  handler: async () => {
    return {
      v1: !!process.env.STRIPE_WEBHOOK_SECRET,
      v2: !!process.env.STRIPE_WEBHOOK_SECRET_V2,
    };
  },
});

export const checkEnvVars = action({
  args: {},
  handler: async () => {
    return {
      stripeSecretKey: !!process.env.STRIPE_SECRET_KEY,
      webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
      webhookSecretV2: !!process.env.STRIPE_WEBHOOK_SECRET_V2,
    };
  },
});

// Setup — seed demo data
export const seedDemoData = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.seed.seedDb, {});
    await ctx.runAction(internal.seed.seedStripe, {});
  },
});

// Setup — sync from Stripe
export const syncProducts = action({
  args: {},
  handler: async (ctx) => stripe.syncAllProducts(ctx),
});

export const syncSubscriptions = action({
  args: {},
  handler: async (ctx) => stripe.syncAllSubscriptions(ctx),
});

export const syncAccounts = action({
  args: {},
  handler: async (ctx) => stripe.syncAllAccounts(ctx),
});

// Reset — clear all app + component data
export const resetAll = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.reset.clearAppDb, {});
    await ctx.runAction(internal.reset.clearStripeDb, {});
  },
});

// Products
export const createProduct = action({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => stripe.createProduct(ctx, args),
});

export const createPrice = action({
  args: {
    stripeProductId: v.string(),
    unitAmount: v.number(),
    currency: v.string(),
    type: v.union(v.literal("one_time"), v.literal("recurring")),
    interval: v.optional(
      v.union(
        v.literal("month"),
        v.literal("year"),
        v.literal("week"),
        v.literal("day"),
      ),
    ),
  },
  handler: async (ctx, args) => stripe.createPrice(ctx, args),
});

export const updateProduct = action({
  args: {
    stripeProductId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => stripe.updateProduct(ctx, args),
});

export const deactivateProduct = action({
  args: { stripeProductId: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => stripe.deactivateProduct(ctx, args),
});

export const createProductForAccount = action({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    accountId: v.string(),
  },
  handler: async (ctx, args) =>
    stripe.createProduct(ctx, {
      name: args.name,
      description: args.description,
      accountId: args.accountId,
    }),
});

// Accounts
export const createAccountWithOnboarding = action({
  args: {
    userId: v.string(),
    email: v.string(),
    country: v.string(),
    refreshUrl: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) =>
    stripe.createAccountWithOnboarding(ctx, {
      userId: args.userId,
      email: args.email,
      country: args.country,
      refreshUrl: args.refreshUrl,
      returnUrl: args.returnUrl,
    }),
});

export const restartAccountOnboarding = action({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) =>
    stripe.restartAccountOnboarding(ctx, {
      stripeAccountId: args.stripeAccountId,
    }),
});

export const getAccountLinkWithStatus = action({
  args: {
    stripeAccountId: v.string(),
    refreshUrl: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => stripe.getAccountLinkWithStatus(ctx, args),
});

export const createBillingPortalSession = action({
  args: {
    stripeAccountId: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => stripe.createBillingPortalSession(ctx, args),
});

// Payment Methods
export const listPaymentMethods = action({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, args) =>
    stripe.listPaymentMethods(ctx, {
      stripeCustomerId: args.stripeCustomerId,
      type: "card",
    }),
});

export const attachPaymentMethod = action({
  args: { paymentMethodId: v.string(), stripeCustomerId: v.string() },
  handler: async (ctx, args) => stripe.attachPaymentMethod(ctx, args),
});

export const detachPaymentMethod = action({
  args: { paymentMethodId: v.string() },
  handler: async (ctx, args) => stripe.detachPaymentMethod(ctx, args),
});

// Checkout

/**
 * Checkout mode for a price (BTS-57): one-time prices check out in `payment`
 * mode, recurring in `subscription` mode. Unknown prices (not yet synced into
 * the component) keep the subscription default; Stripe validates the actual
 * price/mode pairing when the session is created.
 */
export function checkoutModeForPrice(
  price: { type: string } | null,
): "payment" | "subscription" {
  return price?.type === "one_time" ? "payment" : "subscription";
}

export const createCheckoutSession = action({
  args: {
    userId: v.string(),
    stripePriceId: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const price = await stripe.getPriceByStripeId(ctx, {
      stripePriceId: args.stripePriceId,
    });
    return stripe.createCheckoutSession(ctx, {
      userId: args.userId,
      stripePriceId: args.stripePriceId,
      mode: checkoutModeForPrice(price),
      returnUrl: args.returnUrl,
      uiMode: "embedded",
    });
  },
});

// Payouts / balance (BTS-65)
export const getAccountBalance = action({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) =>
    stripe.getAccountBalance(ctx, { stripeAccountId: args.stripeAccountId }),
});

// Subscriptions
export const cancelSubscription = action({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) =>
    stripe.cancelSubscription(ctx, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      cancelAtPeriodEnd: true,
    }),
});

// Affiliate-split demo (BTS-43)

/**
 * Run the affiliate-referral split checkout: a one-time $100 payment for the
 * store's product, routed store + affiliate when `referralCode` attributes it
 * (else store-only). The platform's cut is the configured tiered fee (see
 * stripe.ts); the store/affiliate legs are percent-of-net. The multi-recipient
 * split executes as separate transfers via the webhook engine after the charge
 * — those transfers (tagged by role) are what the demo's SplitBreakdown reads.
 */
export const createAffiliateSplitCheckout = action({
  args: {
    userId: v.string(),
    stripePriceId: v.string(),
    referralCode: v.optional(v.string()),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const personas = await ctx.runQuery(api.queries.getMarketplacePersonas, {});
    if (!personas.store?.accountId) {
      throw new Error(
        "Marketplace store not seeded — run `npm run setup` first.",
      );
    }

    const split = buildSplitRecipients({
      store: {
        accountId: personas.store.accountId,
        name: personas.store.name,
      },
      affiliate: personas.affiliate?.accountId
        ? {
            accountId: personas.affiliate.accountId,
            name: personas.affiliate.name,
          }
        : null,
      referralCode: args.referralCode ?? null,
    });

    return stripe.createCheckoutSession(ctx, {
      userId: args.userId,
      stripePriceId: args.stripePriceId,
      mode: "payment",
      uiMode: "embedded",
      amount: DEMO_SALE_AMOUNT,
      split,
      returnUrl: args.returnUrl,
      // `bs*` keys are reserved and stripped by the component, so use a plain key.
      metadata: { demoReferralCode: args.referralCode ?? "" },
    });
  },
});

// ===========================================================================
// Disputes (BTS-44) — seller disputes page
// ===========================================================================

// Account Session client secret for the embedded disputes surface (BTS-30):
// the ConnectProvider's fetchClientSecret calls this to mount EmbeddedDisputes.
export const createDisputeSession = action({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) => stripe.createDisputeSession(ctx, args),
});

// Submit (or stage) dispute evidence from the headless EvidenceForm. The form
// hands us the shape of EvidenceFormUpdateArgs; `submit: true` finalizes the
// response to the bank, `submit: false` saves a draft.
export const submitDisputeEvidence = action({
  args: {
    stripeDisputeId: v.string(),
    evidence: v.any(),
    submit: v.boolean(),
    stripeAccountId: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    stripe.updateDispute(ctx, {
      stripeDisputeId: args.stripeDisputeId,
      evidence: args.evidence,
      submit: args.submit,
      stripeAccountId: args.stripeAccountId,
    }),
});

// Accept/concede a dispute from the headless seller UI. Stripe closes the
// dispute; the component row and transfer clawback figures refresh from the
// charge.dispute.closed webhook.
export const acceptDispute = action({
  args: {
    stripeDisputeId: v.string(),
    stripeAccountId: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    stripe.closeDispute(ctx, {
      stripeDisputeId: args.stripeDisputeId,
      stripeAccountId: args.stripeAccountId,
    }),
});

// Marketplace account lifecycle (BTS-46) — "one V2 account, configurations
// accrue": a seller onboards via hosted Express as a `recipient` (payouts),
// can add the `customer` configuration to buy as the same account, and can
// add further configurations (recipient/merchant) later if desired.
//
// The "buy something as this account" price-selection logic
// (`selectPurchasablePrices`) is pure and frontend-safe, so it lives in
// `./lib/marketplace.ts` instead of here — this file imports
// `./_generated/server` and the server-only `stripe` client, which a Vite
// frontend page must never pull in.

/**
 * Recipient-only account configuration, applied at creation time via hosted
 * Express onboarding. Distinct from `DEFAULT_ACCOUNT_CONFIGURATION`
 * (`merchant`-only) used by `createAccountWithOnboarding`'s default — this
 * demo models the marketplace/Skool seller (transfers/payouts recipient),
 * not a merchant-of-record. Mirrors the capability shape
 * `addRecipientConfiguration` applies internally.
 */
const RECIPIENT_ACCOUNT_CONFIGURATION = {
  recipient: {
    capabilities: {
      stripe_balance: { stripe_transfers: { requested: true } },
    },
  },
};

export const createMarketplaceAccountOnboarding = action({
  args: {
    userId: v.string(),
    email: v.string(),
    country: v.string(),
    refreshUrl: v.string(),
    returnUrl: v.string(),
  },
  returns: v.object({
    stripeAccountId: v.string(),
    onboardingUrl: v.string(),
  }),
  handler: async (ctx, args) =>
    stripe.createAccountWithOnboarding(ctx, {
      ...args,
      accountConfiguration: RECIPIENT_ACCOUNT_CONFIGURATION,
    }),
});

/**
 * Add the `customer` configuration to an already-onboarded recipient account
 * (BTS-46 step 2) — the same account can now be billed as a buyer.
 * `addCustomerConfiguration` persists `appliedConfigurations` to the
 * component DB itself, so no extra resync is needed here.
 */
export const addMarketplaceCustomerConfig = action({
  args: { stripeAccountId: v.string() },
  returns: v.object({
    success: v.boolean(),
    appliedConfigurations: v.array(v.string()),
  }),
  handler: async (ctx, args) => stripe.addCustomerConfiguration(ctx, args),
});

/**
 * Add the `recipient` configuration to an account that doesn't have it yet
 * (BTS-46 step 3: "adding merchant/recipient later if desired"). Unlike
 * `addCustomerConfiguration`, the library's `addRecipientConfiguration`
 * does not persist `appliedConfigurations` back to the component DB, so this
 * wrapper resyncs via the public `syncAllAccounts` afterward rather than
 * reaching into component internals.
 */
export const addMarketplaceRecipientConfig = action({
  args: { stripeAccountId: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const result = await stripe.addRecipientConfiguration(ctx, args);
    await stripe.syncAllAccounts(ctx);
    return result;
  },
});

/**
 * Add the `merchant` configuration to an account (BTS-46 step 3, continued).
 * There is no dedicated `addMerchantConfiguration` wrapper on `BetterStripe`
 * (only `addRecipientConfiguration`/`addCustomerConfiguration` exist), so
 * this applies it directly via the generic `updateV2Account`, mirroring what
 * `DEFAULT_ACCOUNT_CONFIGURATION` requests at account-creation time, then
 * resyncs for the same reason as the recipient case above.
 */
export const addMarketplaceMerchantConfig = action({
  args: { stripeAccountId: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    await stripe.updateV2Account(ctx, {
      stripeAccountId: args.stripeAccountId,
      updateParams: {
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
        },
      },
    });
    await stripe.syncAllAccounts(ctx);
    return { success: true };
  },
});

/**
 * Purchase a platform price using the seller's OWN account as the buyer
 * (BTS-46 step 2's second half): `accountId` maps to `customer_account` on
 * the Checkout Session, so the same `stripeAccountId` that receives payouts
 * as a recipient is charged as a customer. Redirect mode keeps this demo
 * step independent of the embedded-checkout wiring used elsewhere.
 */
export const createMarketplaceSelfPurchaseCheckout = action({
  args: {
    userId: v.string(),
    stripeAccountId: v.string(),
    stripePriceId: v.string(),
    returnUrl: v.string(),
  },
  returns: v.object({
    stripeSessionId: v.string(),
    clientSecret: v.optional(v.string()),
    url: v.optional(v.string()),
  }),
  handler: async (ctx, args) =>
    stripe.createCheckoutSession(ctx, {
      userId: args.userId,
      accountId: args.stripeAccountId,
      stripePriceId: args.stripePriceId,
      mode: "payment",
      uiMode: "redirect",
      returnUrl: args.returnUrl,
    }),
});
