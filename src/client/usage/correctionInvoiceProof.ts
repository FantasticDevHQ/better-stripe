import { z } from "zod";
export const invoiceCorrectionProof = z.strictObject({
  creditNoteStatus: z.enum(["issued", "void"]),
  stripeAccountId: z.string(),
  livemode: z.boolean(),
  customerAccount: z.string(),
  stripeCustomerId: z.string(),
  subscriptionId: z.string(),
  subscriptionItemId: z.string(),
  stripePriceId: z.string(),
  period: z.strictObject({ start: z.number().int(), end: z.number().int() }),
  creditNoteId: z
    .string()
    .regex(/^cn_[a-zA-Z0-9]+$/)
    .max(100),
  invoiceId: z
    .string()
    .regex(/^in_[a-zA-Z0-9]+$/)
    .max(100),
  invoiceLineId: z.string().max(100),
  currency: z.string().regex(/^[a-z]{3}$/),
  amount: z.number().int().positive().max(99999999),
  prePaymentAmount: z.number().int().nonnegative(),
  postPaymentAmount: z.number().int().nonnegative(),
  paymentIntentId: z
    .string()
    .regex(/^pi_[a-zA-Z0-9]+$/)
    .max(100)
    .nullable(),
  chargeId: z
    .string()
    .regex(/^ch_[a-zA-Z0-9]+$/)
    .max(100)
    .nullable(),
  refundId: z
    .string()
    .regex(/^re_[a-zA-Z0-9]+$/)
    .max(100)
    .nullable(),
});
