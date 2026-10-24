import { z } from "zod";

const id = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[a-z]{3}$/);
const metadata = z.record(z.string(), z.string());
const expectedSchema = z.object({
  stripeSessionId: id("cs"),
  customerAccountId: id("acct"),
  livemode: z.boolean(),
});
const evidenceSchema = z.object({
  id: id("cs"),
  object: z.literal("checkout.session"),
  mode: z.literal("payment"),
  subscription: z.null(),
  status: z.literal("complete"),
  payment_status: z.literal("paid"),
  customer_account: id("acct"),
  livemode: z.boolean(),
  amount_total: amount,
  currency,
  metadata,
  payment_intent: z.object({
    id: id("pi"),
    object: z.literal("payment_intent"),
    status: z.literal("succeeded"),
    customer_account: id("acct"),
    livemode: z.boolean(),
    amount,
    amount_received: amount,
    currency,
    metadata,
    latest_charge: z.object({
      id: id("ch"),
      object: z.literal("charge"),
      payment_intent: id("pi"),
      status: z.literal("succeeded"),
      paid: z.literal(true),
      captured: z.literal(true),
      livemode: z.boolean(),
      amount,
      amount_captured: amount,
      currency,
    }),
  }),
});

/** Server-owned original selectors, not browser authorization or signed-event proof. */
export type CapturedCheckoutPaymentExpected = z.infer<typeof expectedSchema>;

export type CapturedCheckoutPaymentObservation =
  | {
      status: "ready";
      stripeSessionId: string;
      stripePaymentIntentId: string;
      stripeChargeId: string;
      customerAccountId: string;
      livemode: boolean;
      /** Integer original provider minor units, never converted to major-unit decimals. */
      amount: number;
      currency: string;
      sessionMetadata: Record<string, string>;
      paymentIntentMetadata: Record<string, string>;
    }
  | {
      status: "unavailable";
      reason: "invalid_context" | "invalid_evidence" | "identity_mismatch";
    };

/**
 * Qualify an already retrieved Session with payment_intent.latest_charge expanded.
 * No I/O or writes. Captured history is not fulfillment, refund or settlement authority.
 */
export function qualifyCapturedCheckoutPayment(
  session: unknown,
  expected: CapturedCheckoutPaymentExpected,
): CapturedCheckoutPaymentObservation {
  const scope = expectedSchema.safeParse(expected);
  if (!scope.success)
    return { status: "unavailable", reason: "invalid_context" };
  const parsed = evidenceSchema.safeParse(session);
  if (!parsed.success)
    return { status: "unavailable", reason: "invalid_evidence" };
  const paid = parsed.data;
  const pi = paid.payment_intent;
  const charge = pi.latest_charge;
  if (
    paid.id !== scope.data.stripeSessionId ||
    paid.customer_account !== scope.data.customerAccountId ||
    pi.customer_account !== scope.data.customerAccountId ||
    paid.livemode !== scope.data.livemode ||
    pi.livemode !== scope.data.livemode ||
    charge.livemode !== scope.data.livemode ||
    charge.payment_intent !== pi.id ||
    pi.amount !== paid.amount_total ||
    pi.amount_received !== paid.amount_total ||
    charge.amount !== paid.amount_total ||
    charge.amount_captured !== paid.amount_total ||
    pi.currency !== paid.currency ||
    charge.currency !== paid.currency
  )
    return { status: "unavailable", reason: "identity_mismatch" };
  return {
    status: "ready",
    stripeSessionId: paid.id,
    stripePaymentIntentId: pi.id,
    stripeChargeId: charge.id,
    customerAccountId: paid.customer_account,
    livemode: paid.livemode,
    amount: paid.amount_total,
    currency: paid.currency,
    sessionMetadata: paid.metadata,
    paymentIntentMetadata: pi.metadata,
  };
}
