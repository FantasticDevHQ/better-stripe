import { z } from "zod";
const id = (prefix: string) =>
  z
    .string()
    .regex(new RegExp("^" + prefix + "_[a-zA-Z0-9_]+$"))
    .max(200);
export const paymentCreditProof = z.strictObject({
  paymentIntentId: id("pi"),
  chargeId: id("ch"),
  amount: z.number().int().min(1).max(99999999),
  currency: z.string().regex(/^[a-z]{3}$/),
  customerAccount: id("acct"),
  livemode: z.boolean(),
});
export const grantCreditProof = paymentCreditProof.extend({
  creditGrantId: id("credgr"),
  stripePriceId: id("price"),
  effectiveAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
});

export const creditNativeObservation = z.strictObject({
  creditGrantId: id("credgr"),
  paymentIntentId: id("pi"),
  currency: z.string().regex(/^[a-z]{3}$/),
  ledgerAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  availableAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  granted: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  applied: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expired: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  voided: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  reinstated: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  invoicesVerified: z.boolean(),
  complete: z.boolean(),
  transactions: z
    .array(
      z.strictObject({
        id: z
          .string()
          .regex(/^cbtxn_[a-zA-Z0-9_]+$/)
          .max(200),
        kind: z.enum([
          "credits_granted",
          "credits_applied",
          "credits_expired",
          "credits_voided",
          "credits_application_invoice_voided",
        ]),
        amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        invoiceId: id("in").nullable(),
        invoiceLineId: z.string().max(200).nullable(),
      }),
    )
    .max(100),
});
