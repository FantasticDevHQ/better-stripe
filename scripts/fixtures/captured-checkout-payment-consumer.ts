import {
  qualifyCapturedCheckoutPayment,
  type CapturedCheckoutPaymentExpected,
  type CapturedCheckoutPaymentObservation,
} from "@fantastic.dev/better-stripe";

const expected: CapturedCheckoutPaymentExpected = {
  stripeSessionId: "cs_original",
  customerAccountId: "acct_buyer",
  livemode: false,
};
export function observe(session: unknown) {
  const result: CapturedCheckoutPaymentObservation =
    qualifyCapturedCheckoutPayment(session, expected);
  if (result.status === "unavailable") {
    const reason: "invalid_context" | "invalid_evidence" | "identity_mismatch" =
      result.reason;
    // @ts-expect-error Unavailable evidence has no qualified payment amount.
    result.amount;
    return reason;
  }
  const amount: number = result.amount;
  const metadata: Record<string, string> = result.paymentIntentMetadata;
  const sessionMetadata: Record<string, string> = result.sessionMetadata;
  // @ts-expect-error Captured observation does not establish refund authority.
  result.refundable;
  return { amount, metadata, sessionMetadata };
}
qualifyCapturedCheckoutPayment(
  {},
  // @ts-expect-error Original V2 account scope is required.
  { stripeSessionId: "cs_original", livemode: false },
);
// @ts-expect-error Livemode is an explicit boolean, not a coercible string.
qualifyCapturedCheckoutPayment({}, { ...expected, livemode: "test" });
