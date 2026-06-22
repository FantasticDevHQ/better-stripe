import Stripe from "stripe";

import { STRIPE_API_VERSION } from "../constants.js";
import type { Component } from "../helpers.js";
import type { StripeApiVersion } from "../stripe-types.js";
import type { WebhookActionCtx } from "../types.js";
import type { TriggerDispatcherName } from "../types/triggers.js";

const TO_REFERENCE_PATH = Symbol.for("toReferencePath");

// =============================================================================
// COMPONENT FUNCTION MAP
// =============================================================================

const COMPONENT_FUNCTION_MAP: Record<string, string> = {
  // Core
  getAccount: "core/queries/getAccount",
  getAccountByStripeId: "core/queries/getAccountByStripeId",
  getAccountByUserId: "core/queries/getAccountByUserId",
  getAccountByOrgId: "core/queries/getAccountByOrgId",
  getAccountOnboardingStatus: "core/queries/getAccountOnboardingStatus",
  getPublishableKey: "core/queries/getPublishableKey",
  getStripeMode: "core/queries/getStripeMode",
  upsertAccount: "core/mutations/upsertAccount",
  upsertAccountInternal: "core/mutations/upsertAccountInternal",
  deleteAccountByStripeId: "core/mutations/deleteAccountByStripeId",
  clearAllTables: "core/mutations/clearAllTables",
  // Products
  getProduct: "products/queries/getProduct",
  getProductByStripeId: "products/queries/getProductByStripeId",
  listProducts: "products/queries/listProducts",
  getPrice: "products/queries/getPrice",
  getPriceByStripeId: "products/queries/getPriceByStripeId",
  listPrices: "products/queries/listPrices",
  listPricesByProduct: "products/queries/listPricesByProduct",
  upsertProduct: "products/mutations/upsertProduct",
  upsertPrice: "products/mutations/upsertPrice",
  // Billing
  getSubscription: "billing/queries/getSubscription",
  getSubscriptionByStripeId: "billing/queries/getSubscriptionByStripeId",
  listSubscriptions: "billing/queries/listSubscriptions",
  listSubscriptionsByUser: "billing/queries/listSubscriptionsByUser",
  listSubscriptionsByOrg: "billing/queries/listSubscriptionsByOrg",
  getActiveSubscription: "billing/queries/getActiveSubscription",
  getTrialStatus: "billing/queries/getTrialStatus",
  getCheckoutSession: "billing/queries/getCheckoutSession",
  getCheckoutSessionByStripeId: "billing/queries/getCheckoutSessionByStripeId",
  listCheckoutSessionsByUser: "billing/queries/listCheckoutSessionsByUser",
  getInvoiceByStripeId: "billing/queries/getInvoiceByStripeId",
  listInvoices: "billing/queries/listInvoices",
  upsertSubscription: "billing/mutations/upsertSubscription",
  upsertCheckoutSession: "billing/mutations/upsertCheckoutSession",
  upsertInvoice: "billing/mutations/upsertInvoice",
  // Connect
  getPaymentByStripeId: "connect/queries/getPaymentByStripeId",
  getPayout: "connect/queries/getPayout",
  getPayoutByStripeId: "connect/queries/getPayoutByStripeId",
  listPayouts: "connect/queries/listPayouts",
  upsertPayment: "connect/mutations/upsertPayment",
  upsertPayout: "connect/mutations/upsertPayout",
  getRefundByStripeId: "connect/queries/getRefundByStripeId",
  listRefunds: "connect/queries/listRefunds",
  upsertRefund: "connect/mutations/upsertRefund",
  getDisputeByStripeId: "connect/queries/getDisputeByStripeId",
  listDisputes: "connect/queries/listDisputes",
  upsertDispute: "connect/mutations/upsertDispute",
  // Webhooks
  getWebhookEvent: "webhooks/queries/getWebhookEvent",
  insertWebhookEvent: "webhooks/mutations/insertWebhookEvent",
  markWebhookEventProcessed: "webhooks/mutations/markWebhookEventProcessed",
  markWebhookEventFailed: "webhooks/mutations/markWebhookEventFailed",
  markWebhookEventIgnored: "webhooks/mutations/markWebhookEventIgnored",
};

// =============================================================================
// HELPERS
// =============================================================================

export function getStripeClient(
  secretKey: string,
  apiVersion?: string,
): Stripe {
  return new Stripe(secretKey, {
    apiVersion: (apiVersion as StripeApiVersion) || STRIPE_API_VERSION,
  });
}

export function epochToIso(
  epoch: number | null | undefined,
): string | undefined {
  if (epoch == null) return undefined;
  return new Date(epoch * 1000).toISOString();
}

export function deriveTrialFields(subscription: Stripe.Subscription): {
  isTrialing: boolean;
  trialStart: string | undefined;
  trialEnd: string | undefined;
} {
  return {
    isTrialing: subscription.status === "trialing",
    trialStart: epochToIso(subscription.trial_start),
    trialEnd: epochToIso(subscription.trial_end),
  };
}

/**
 * Extracts userId and orgId from Stripe object metadata.
 *
 * Returns userId `""` when the Stripe object has no userId metadata
 * (e.g. created in the Stripe Dashboard). `""` rows are stored but
 * never matched by user-scoped queries.
 */
export function extractIdentifiers(
  metadata: Record<string, string> | null | undefined,
): { userId: string; orgId: string | undefined } {
  return {
    userId: metadata?.userId ?? metadata?.user_id ?? "",
    orgId: metadata?.orgId ?? metadata?.org_id ?? undefined,
  };
}

export function jsonResponse(
  data: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Resolve a component function reference by export name.
 *
 * Uses an anchor ref from the component to derive the base path prefix,
 * then looks up the function's new domain path from COMPONENT_FUNCTION_MAP.
 */
export function getComponentRef(
  component: Component,
  _moduleName: string,
  exportName: string,
) {
  // Try direct property access on the component proxy first
  // (handles both old flat paths and new nested paths)
  const parts = COMPONENT_FUNCTION_MAP[exportName]?.split("/") ?? [];
  if (parts.length > 0) {
    let ref: any = component;
    for (const part of parts) {
      ref = ref?.[part];
      if (!ref) break;
    }
    if (ref?.[TO_REFERENCE_PATH]) return ref;
  }

  // Construct synthetic ref from an anchor
  const anchor = findAnchorRef(component);
  if (!anchor) {
    throw new Error(
      `[better-stripe] Cannot resolve component ref for ${exportName}: ` +
        `no anchor ref available on component.`,
    );
  }

  const anchorPath: string = anchor[TO_REFERENCE_PATH];
  // Extract the component prefix (e.g. 'betterStripe')
  const basePath = anchorPath.split("/")[0];

  const mappedPath = COMPONENT_FUNCTION_MAP[exportName];
  if (mappedPath) {
    return { [TO_REFERENCE_PATH]: `${basePath}/${mappedPath}` } as any;
  }

  // Fallback: assume same module
  const modulePrefix = anchorPath.replace(/\/[^/]+$/, "");
  return { [TO_REFERENCE_PATH]: `${modulePrefix}/${exportName}` } as any;
}

/**
 * Generic helper to resolve a component function by its full domain path.
 * Example: componentRef(component, 'core/queries/getAccount')
 */
export function componentRef(component: Component, path: string) {
  // Try direct property access
  const parts = path.split("/");

  let ref: any = component;
  for (const part of parts) {
    ref = ref?.[part];
    if (!ref) break;
  }
  if (ref?.[TO_REFERENCE_PATH]) return ref;

  // Construct synthetic ref from anchor
  const anchor = findAnchorRef(component);
  if (!anchor?.[TO_REFERENCE_PATH]) {
    throw new Error(`[better-stripe] Cannot resolve component path: ${path}`);
  }
  const anchorPath: string = anchor[TO_REFERENCE_PATH];
  const basePath = anchorPath.split("/")[0];
  return { [TO_REFERENCE_PATH]: `${basePath}/${path}` } as any;
}

/**
 * Component upsert mutation path for each trigger dispatcher. Single source
 * of truth shared by `dispatchUpsert` (direct-mutation fallback) and
 * `webhookHandlers()`'s dispatcher specs — keeps the pairing in sync by
 * construction.
 */
export const DISPATCHER_UPSERT_PATHS: Record<TriggerDispatcherName, string> = {
  accountUpserted: "core/mutations/upsertAccountInternal",
  productUpserted: "products/mutations/upsertProduct",
  priceUpserted: "products/mutations/upsertPrice",
  subscriptionUpserted: "billing/mutations/upsertSubscription",
  subscriptionDeleted: "billing/mutations/upsertSubscription",
  checkoutSessionUpserted: "billing/mutations/upsertCheckoutSession",
  invoiceUpserted: "billing/mutations/upsertInvoice",
  paymentUpserted: "connect/mutations/upsertPayment",
  payoutUpserted: "connect/mutations/upsertPayout",
  refundUpserted: "connect/mutations/upsertRefund",
  disputeUpserted: "connect/mutations/upsertDispute",
};

/**
 * Run a domain upsert. When the app registered the `webhooks` handler pair,
 * route through `syncWebhook` so the sync trigger runs in the same transaction
 * as the component write. Otherwise call the component mutation directly.
 */
export async function dispatchUpsert(
  whCtx: WebhookContext,
  dispatcherName: TriggerDispatcherName,
  data: Record<string, unknown>,
): Promise<void> {
  const refs = whCtx.config?.webhooks;
  if (refs) {
    await whCtx.ctx.runMutation(refs.syncWebhook, {
      dispatcher: dispatcherName,
      data,
    });
  } else {
    await whCtx.ctx.runMutation(
      componentRef(whCtx.component, DISPATCHER_UPSERT_PATHS[dispatcherName]),
      data,
    );
  }
}

function findAnchorRef(component: Component): any {
  const comp = component as any;
  // Try new paths first, then old
  const candidates = [
    comp?.core?.queries?.getAccount,
    comp?.public?.getAccount,
  ];
  for (const c of candidates) {
    if (c?.[TO_REFERENCE_PATH]) return c;
  }
  // Walk the component to find any ref
  for (const key of Object.keys(comp ?? {})) {
    const mod = comp[key];
    if (!mod || typeof mod !== "object") continue;
    for (const fn of Object.keys(mod)) {
      if (mod[fn]?.[TO_REFERENCE_PATH]) return mod[fn];
    }
    // Check nested (e.g. core.queries.getAccount)
    for (const subKey of Object.keys(mod)) {
      const sub = mod[subKey];
      if (!sub || typeof sub !== "object") continue;
      for (const fn of Object.keys(sub)) {
        if (sub[fn]?.[TO_REFERENCE_PATH]) return sub[fn];
      }
    }
  }
  return null;
}

// =============================================================================
// TYPES
// =============================================================================

export type WebhookContext = {
  ctx: WebhookActionCtx;
  component: Component;
  config?: import("../types.js").RegisterRoutesConfig;
  stripe: Stripe;
  webhookSecret: string;
};
