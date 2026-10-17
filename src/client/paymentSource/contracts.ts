import { z } from "zod";

const identifier = z.string().min(1).max(200);
export const paymentSourceOptions = z
  .object({
    paymentIntentId: identifier,
    customerAccountId: identifier.optional(),
    stripeAccountId: identifier.optional(),
    invoiceId: identifier.optional(),
    subscriptionId: identifier.optional(),
    currency: z.string().regex(/^[a-z]{3}$/),
    gross: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    maxHistoryPages: z.number().int().min(1).max(20).default(5),
    maxHistoryItems: z.number().int().min(1).max(2000).default(500),
  })
  .strict();
export type VerifiedPaymentSourceOptions = z.input<typeof paymentSourceOptions>;
/** Provider identities/economics only. The host still authorizes these identities. */
export type VerifiedPaymentSource = Readonly<{
  paymentIntentId: string;
  chargeId: string;
  invoiceId: string;
  invoicePaymentId: string;
  subscriptionId?: string;
  customerAccountId: string;
  stripeAccountId?: string;
  stripePriceId: string;
  stripeProductId: string;
  gross: number;
  processingFee: number;
  currency: string;
  livemode: boolean;
}>;
