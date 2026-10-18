type Card = { id: string; livemode: boolean; customer_account: string | null };
export async function attachDemoInvoiceCard(
  raw: {
    paymentMethods: {
      attach: (
        id: string,
        params: { customer_account: string },
        options: { idempotencyKey: string },
      ) => Promise<Card>;
    };
  },
  card: Card,
  customerAccount: string,
  runId: string,
): Promise<string> {
  if (
    card.livemode ||
    (card.customer_account && card.customer_account !== customerAccount)
  )
    throw new Error("The card must belong to the original sandbox payer.");
  const saved = card.customer_account
    ? card
    : await raw.paymentMethods.attach(
        card.id,
        { customer_account: customerAccount },
        { idempotencyKey: `bs_demo_${runId}_attach_card` },
      );
  if (
    saved.id !== card.id ||
    saved.livemode ||
    saved.customer_account !== customerAccount
  )
    throw new Error("The card must belong to the original sandbox payer.");
  return saved.id;
}
export function demoSubscriptionRef(input: {
  scope: {
    stripeAccountId: string;
    customerAccount: string;
    livemode: boolean;
    meterId?: string;
  };
  requestId: string;
}) {
  const { stripeAccountId, customerAccount, livemode } = input.scope;
  return {
    scope: { stripeAccountId, customerAccount, livemode },
    requestId: input.requestId,
  };
}
