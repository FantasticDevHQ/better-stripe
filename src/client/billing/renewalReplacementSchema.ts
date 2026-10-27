import { z } from "zod";

const id = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const integer = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const product = z.union([
  id("prod"),
  z
    .object({ id: id("prod"), deleted: z.literal(false).optional() })
    .passthrough(),
]);
export const renewalPrice = z
  .object({
    id: id("price"),
    object: z.literal("price"),
    product,
    active: z.boolean(),
    livemode: z.boolean(),
    type: z.literal("recurring"),
    currency: z.string().regex(/^[a-z]{3}$/),
    billing_scheme: z.literal("per_unit"),
    recurring: z
      .object({
        interval: z.enum(["day", "week", "month", "year"]),
        interval_count: integer,
        usage_type: z.literal("licensed"),
      })
      .passthrough(),
  })
  .passthrough();

export const renewalExpected = z
  .object({
    customerAccountId: id("acct"),
    subscriptionId: id("sub"),
    itemId: id("si"),
    currentPriceId: id("price"),
    currentProductId: id("prod"),
    targetPriceId: id("price"),
    targetProductId: id("prod"),
    periodStart: integer,
    periodEnd: integer,
    livemode: z.boolean(),
  })
  .strict()
  .refine((v) => v.periodEnd > v.periodStart, "Invalid original period.");

export const renewalSubscription = z
  .object({
    id: id("sub"),
    object: z.literal("subscription"),
    customer_account: id("acct"),
    status: z.literal("active"),
    livemode: z.boolean(),
    schedule: z.null(),
    cancel_at: z.null(),
    cancel_at_period_end: z.literal(false),
    pause_collection: z.null(),
    pending_update: z.null(),
    default_source: z.null(),
    application_fee_percent: z.null(),
    payment_settings: z.union([
      z.null(),
      z
        .object({
          payment_method_options: z.null(),
          payment_method_types: z.null(),
          save_default_payment_method: z.literal("off").nullable(),
        })
        .strict(),
    ]),
    billing_schedules: z.array(z.unknown()).length(0).optional(),
    items: z
      .object({
        has_more: z.literal(false),
        data: z.tuple([
          z
            .object({
              id: id("si"),
              object: z.literal("subscription_item"),
              subscription: id("sub"),
              current_period_start: integer,
              current_period_end: integer,
              quantity: integer,
              price: renewalPrice,
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  })
  .passthrough();

/** Trusted host selectors from the original authorized operation, not browser claims. */
export type RenewalPriceReplacementExpected = z.infer<typeof renewalExpected>;

export const renewalBillingCustomer = z
  .object({
    id: id("cus"),
    object: z.literal("customer"),
    customer_account: id("acct"),
    livemode: z.boolean(),
    deleted: z.literal(false).optional(),
    discount: z.union([
      z.null(),
      z
        .object({
          id: id("di"),
          object: z.literal("discount"),
          deleted: z.literal(false).optional(),
        })
        .passthrough(),
    ]),
  })
  .passthrough();

export const renewalPreparationInput = z
  .object({
    subscription: z.unknown(),
    targetPrice: z.unknown(),
    billingCustomer: z.unknown().optional(),
    expected: renewalExpected,
    key: z.string(),
  })
  .strict();
