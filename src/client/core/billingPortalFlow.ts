import { z } from "zod";

const id = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const redirectUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, "A public HTTP(S) redirect URL is required.");
const item = z
  .object({
    id: id("si"),
    price: id("price"),
    quantity: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict();
const flow = z
  .object({
    type: z.literal("subscription_update_confirm"),
    subscription_update_confirm: z
      .object({
        subscription: id("sub"),
        items: z.tuple([item]),
      })
      .strict(),
    after_completion: z
      .object({
        type: z.literal("redirect"),
        redirect: z.object({ return_url: redirectUrl }).strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** One existing subscription item; host authorization and target policy remain required. */
export type BillingPortalSubscriptionUpdateFlow = z.infer<typeof flow>;

// Parsing makes a bounded scalar copy before the first provider await.
export const billingPortalSessionOptions = z
  .object({
    stripeAccountId: id("acct"),
    connectedAccountId: id("acct").optional(),
    configurationId: id("bpc").optional(),
    returnUrl: redirectUrl,
    flowData: flow.optional(),
  })
  .strict();
export const targetedPortalOptions = billingPortalSessionOptions.extend({
  flowData: flow,
});

export function assertTargetedPortalSubscription(
  value: unknown,
  options: z.infer<typeof targetedPortalOptions>,
): void {
  const subscription = z
    .object({
      object: z.literal("subscription"),
      id: id("sub"),
      deleted: z.literal(false).optional(),
      customer_account: id("acct"),
      items: z.object({
        has_more: z.literal(false),
        data: z.array(z.object({ id: id("si") })).max(100),
      }),
    })
    .parse(value);
  const target = options.flowData.subscription_update_confirm;
  if (
    subscription.id !== target.subscription ||
    subscription.customer_account !== options.stripeAccountId ||
    subscription.items.data.filter((entry) => entry.id === target.items[0].id)
      .length !== 1
  )
    throw new Error(
      "The original subscription item does not belong to this customer account.",
    );
  if (subscription.items.data.length !== 1)
    throw new Error(
      "Billing Portal confirmation does not support multi-item subscriptions.",
    );
}
