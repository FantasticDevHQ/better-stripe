import { z } from "zod";

const id = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
export const reference = (prefix: string, object: string) =>
  z.union([
    id(prefix),
    z
      .object({
        id: id(prefix),
        object: z.literal(object),
        deleted: z.literal(false).optional(),
        livemode: z.boolean().optional(),
        customer: z
          .union([
            id("cus"),
            z
              .object({
                id: id("cus"),
                object: z.literal("customer"),
                deleted: z.literal(false).optional(),
                livemode: z.boolean().optional(),
                customer_account: id("acct").nullable().optional(),
              })
              .passthrough(),
          ])
          .nullable()
          .optional(),
        customer_account: id("acct").nullable().optional(),
      })
      .passthrough(),
  ]);
const account = reference("acct", "account");
const issuer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("self"), account: z.null().optional() }).strict(),
  z.object({ type: z.literal("account"), account }).strict(),
]);
const invoiceTaxId = z.union([
  id("txi"),
  z
    .object({
      id: id("txi"),
      object: z.literal("tax_id"),
      deleted: z.literal(false).optional(),
      livemode: z.boolean(),
      customer: z.null().optional(),
      customer_account: z.null().optional(),
      owner: z.discriminatedUnion("type", [
        z
          .object({
            type: z.literal("self"),
            customer_account: z.null(),
            account: z.null().optional(),
            customer: z.null().optional(),
          })
          .strict(),
        z
          .object({
            type: z.literal("account"),
            account,
            customer_account: z.null(),
            customer: z.null().optional(),
          })
          .strict(),
      ]),
    })
    .passthrough(),
]);
export const taxRate = z
  .object({
    id: id("txr"),
    object: z.literal("tax_rate"),
    deleted: z.literal(false).optional(),
    livemode: z.boolean(),
  })
  .passthrough();
const string = z.string().max(5000);
export const settingsInput = z
  .object({
    context: z
      .object({
        customerAccountId: id("acct"),
        customerId: id("cus"),
        livemode: z.boolean(),
        effectiveCollectionMethod: z.enum([
          "charge_automatically",
          "send_invoice",
        ]),
        effectiveAutomaticTax: z.boolean(),
        effectiveInvoiceIssuer: issuer,
      })
      .strict(),
    settings: z
      .object({
        application_fee_percent: z.null(),
        billing_thresholds: z.null(),
        collection_method: z
          .enum(["charge_automatically", "send_invoice"])
          .nullable(),
        default_payment_method: reference("pm", "payment_method").nullable(),
        on_behalf_of: account.nullable(),
        transfer_data: z
          .object({
            destination: account,
            amount_percent: z
              .number()
              .min(0)
              .max(100)
              .multipleOf(0.01)
              .nullable(),
          })
          .strict()
          .nullable(),
        automatic_tax: z
          .object({
            enabled: z.boolean(),
            liability: issuer.nullable().optional(),
            disabled_reason: z.null().optional(),
          })
          .strict()
          .optional(),
        default_tax_rates: z.array(taxRate).max(20).nullable().optional(),
        invoice_settings: z
          .object({
            account_tax_ids: z.array(invoiceTaxId).max(20).nullable(),
            custom_fields: z
              .array(
                z
                  .object({
                    name: z.string().max(40),
                    value: z.string().max(140),
                  })
                  .strict(),
              )
              .max(4)
              .nullable(),
            days_until_due: z.number().int().nonnegative().max(3650).nullable(),
            description: string.nullable(),
            footer: string.nullable(),
            issuer: issuer.nullable(),
          })
          .strict()
          .nullable(),
        description: string.nullable(),
        metadata: z
          .record(z.string().max(40), z.string().min(1).max(500))
          .nullable(),
      })
      .strict(),
  })
  .strict();
