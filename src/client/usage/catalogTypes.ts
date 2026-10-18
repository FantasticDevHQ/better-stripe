import type Stripe from "stripe";
import { z } from "zod";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { defineUsagePlan, type UsagePlan } from "./contracts.js";
import type { Doc } from "../../component/_generated/dataModel.js";
export type UsageCatalogScope = { stripeAccountId: string; livemode: boolean };
export type UsageMeterOptions = {
  scope: UsageCatalogScope;
  plan: UsagePlan;
  eventName: string;
  displayName: string;
};
export type UsagePriceOptions = {
  scope: UsageCatalogScope;
  plan: UsagePlan;
  meterId: string;
  stripeProductId: string;
  lookupKey: string;
};
export class UsageCatalogError extends Error {
  constructor(
    public readonly code:
      | "unsupported_scope"
      | "incompatible_terms"
      | "ambiguous_lookup"
      | "unknown_create_outcome"
      | "provider_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "UsageCatalogError";
  }
}
const scopeSchema = z.strictObject({
  stripeAccountId: z
    .string()
    .regex(/^acct_[a-zA-Z0-9]+$/)
    .max(100),
  livemode: z.boolean(),
});
export function catalogScope(scope: UsageCatalogScope) {
  return scopeSchema.parse(scope);
}
export function meterTerms(opts: UsageMeterOptions) {
  return {
    scope: catalogScope(opts.scope),
    plan: defineUsagePlan(opts.plan),
    eventName: z
      .string()
      .regex(/^[\w.-]{1,100}$/)
      .parse(opts.eventName),
    displayName: z.string().min(1).max(100).parse(opts.displayName),
  };
}
export function meterKey(plan: UsagePlan) {
  return JSON.stringify([plan.key, plan.version]);
}
export async function nativeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch {
    throw new UsageCatalogError(
      "provider_unavailable",
      "Native Stripe catalog is unavailable",
    );
  }
}
export async function verifyRealm(stripe: Stripe, scope: UsageCatalogScope) {
  const parsed = catalogScope(scope);
  const [account, balance] = await Promise.all([
    nativeCall(() => stripe.accounts.retrieve(null)),
    nativeCall(() => stripe.balance.retrieve()),
  ]);
  if (
    account.id !== parsed.stripeAccountId ||
    balance.livemode !== parsed.livemode
  )
    throw new UsageCatalogError(
      "unsupported_scope",
      "Native catalog scope must match the configured Stripe realm and mode",
    );
}
export async function operationKey(terms: unknown, kind: string) {
  const bytes = new TextEncoder().encode(JSON.stringify(terms));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `bs_usage_${kind}_${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("")}`;
}
export async function prepareCatalog(
  component: Component,
  ctx: RunCtx,
  kind: "meter" | "price",
  scope: UsageCatalogScope,
  key: string,
  terms: unknown,
): Promise<Doc<"usageCatalog">> {
  return runMutationOrThrow(
    ctx,
    componentRef(component, "usageCatalog/mutations/prepare"),
    {
      scopeKey: JSON.stringify(catalogScope(scope)),
      kind,
      key,
      termsJson: JSON.stringify(terms),
    },
  );
}
export async function completeCatalog(
  component: Component,
  ctx: RunCtx,
  row: Doc<"usageCatalog">,
  providerId: string,
  observation: unknown,
) {
  return runMutationOrThrow(
    ctx,
    componentRef(component, "usageCatalog/mutations/complete"),
    {
      scopeKey: row.scopeKey,
      kind: row.kind,
      key: row.key,
      providerId,
      observationJson: JSON.stringify(observation),
    },
  );
}
export function permitCreate(row: Doc<"usageCatalog">) {
  if (Date.now() / 1000 - row.firstAttemptAt >= 23 * 3600)
    throw new UsageCatalogError(
      "unknown_create_outcome",
      "Native catalog create requires reconciliation after its safe retry window",
    );
}

export function verifyMeter(
  meter: Stripe.Billing.Meter,
  opts: UsageMeterOptions,
  active = true,
) {
  if (
    meter.livemode !== opts.scope.livemode ||
    meter.event_name !== opts.eventName ||
    meter.default_aggregation.formula !== "sum" ||
    meter.customer_mapping.type !== "by_id" ||
    meter.customer_mapping.event_payload_key !== "stripe_customer_id" ||
    meter.value_settings.event_payload_key !== "value" ||
    meter.event_time_window !== null ||
    !["active", "inactive"].includes(meter.status) ||
    (active && meter.status !== "active")
  )
    throw new UsageCatalogError(
      "incompatible_terms",
      "Native meter has incompatible immutable terms or status",
    );
}

export function meterObservation(meter: Stripe.Billing.Meter) {
  return {
    type: "meter",
    id: meter.id,
    eventName: meter.event_name,
    displayName: meter.display_name,
    active: meter.status === "active",
    livemode: meter.livemode,
    aggregation: meter.default_aggregation.formula,
    customerPayloadKey: meter.customer_mapping.event_payload_key,
    valuePayloadKey: meter.value_settings.event_payload_key,
  };
}
