import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { idempotencyOptions } from "../core/idempotency.js";
import { renderCheckoutSession } from "./checkoutRequest.js";

export type PreparedCheckoutSession = Awaited<
  ReturnType<typeof renderCheckoutSession>
>;
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item))
      throw new Error("Checkout request must be serializable.");
    if (["function", "symbol", "bigint"].includes(typeof item))
      throw new Error("Checkout request must be serializable.");
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    return item;
  });
}
function snapshot<T>(value: T): T {
  return JSON.parse(canonical(value)) as T;
}
function validateCorrelation(prepared: PreparedCheckoutSession) {
  const { request, row, options } = prepared;
  const nested =
    request.mode === "subscription"
      ? request.subscription_data?.metadata
      : request.mode === "payment"
        ? request.payment_intent_data?.metadata
        : undefined;
  if (
    request.mode !== options.mode ||
    request.customer_account !== options.accountId ||
    request.customer_email !==
      (options.accountId ? undefined : options.customerEmail) ||
    request.line_items?.length !== 1 ||
    request.line_items[0]?.price !== options.stripePriceId ||
    canonical(request.metadata) !== canonical(row.metadata) ||
    (request.mode !== "setup" &&
      Object.entries(row.metadata).some(
        ([key, value]) => nested?.[key] !== value,
      ))
  )
    throw new Error("Prepared Checkout correlation does not match.");
  const generated =
    request.mode === "subscription"
      ? prepared.routingMetadata.subscription
      : prepared.routingMetadata.payment;
  const reserved = new Set(
    [...Object.keys(nested ?? {}), ...Object.keys(generated ?? {})].filter(
      (key) => key.startsWith("bs"),
    ),
  );
  if ([...reserved].some((key) => nested?.[key] !== generated?.[key]))
    throw new Error("Prepared Checkout routing metadata does not match.");
}
/** Read-only preparation. Persist the whole snapshot under host-owned immutable authorization. */
export async function prepareCheckoutSession(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: Parameters<typeof renderCheckoutSession>[3],
): Promise<PreparedCheckoutSession> {
  const prepared = snapshot(
    await renderCheckoutSession(stripe, component, ctx, snapshot(opts)),
  );
  validateCorrelation(prepared);
  return prepared;
}
/** Execute only a trusted server snapshot. Ownership and durable request binding belong to the host. */
export async function executePreparedCheckoutSession(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  args: { prepared: PreparedCheckoutSession; idempotencyKey: string },
) {
  const requestOptions = idempotencyOptions(args.idempotencyKey);
  if (!requestOptions)
    throw new Error("Prepared Checkout requires an explicit idempotency key.");
  const prepared = snapshot(args.prepared);
  if (prepared.version !== 1)
    throw new Error("Unsupported prepared Checkout version.");
  if (
    prepared.options.idempotencyKey !== undefined &&
    prepared.options.idempotencyKey !== args.idempotencyKey
  )
    throw new Error("Prepared Checkout idempotency key does not match.");
  validateCorrelation(prepared);
  const expected = snapshot(
    await renderCheckoutSession(
      stripe,
      component,
      ctx,
      prepared.options,
      prepared.descriptor,
    ),
  );
  if (canonical(prepared) !== canonical(expected))
    throw new Error(
      "Prepared Checkout request does not match its bound context.",
    );
  return submitPreparedCheckout(
    stripe,
    component,
    ctx,
    prepared,
    args.idempotencyKey,
  );
}
/** Shared legacy submission. Its input has already passed the maintained renderer's safeguards. */
export async function submitPreparedCheckout(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  prepared: PreparedCheckoutSession,
  key?: string,
) {
  const options = idempotencyOptions(key);
  const session = options
    ? await stripe.checkout.sessions.create(prepared.request, options)
    : await stripe.checkout.sessions.create(prepared.request);
  await runMutationOrThrow(
    ctx,
    componentRef(component, "billing/mutations/upsertCheckoutSession"),
    {
      ...prepared.row,
      stripeSessionId: session.id,
      mode: prepared.request.mode,
      status: (session.status ?? "open") as "open" | "complete" | "expired",
      clientSecret: session.client_secret ?? undefined,
      url: session.url ?? undefined,
    },
  );
  return {
    stripeSessionId: session.id,
    clientSecret: session.client_secret ?? undefined,
    url: session.url ?? undefined,
  };
}
