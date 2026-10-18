type InvoiceIdentity = {
  id: string;
  livemode: boolean;
  customer_account?: string | null;
  customer: string | { id: string } | null;
  parent?: {
    subscription_details?: { subscription: string | { id: string } } | null;
  } | null;
  billing_reason: string | null;
  period_end: number;
};
export function selectDemoInvoice<T extends InvoiceIdentity>(
  page: { data: T[]; has_more: boolean },
  original: {
    customerAccount: string;
    customerId: string;
    subscriptionId: string;
    periodEnd: number;
  },
): T | null {
  if (page.has_more)
    throw new Error("Complete native invoice history is required.");
  const matches = page.data.filter((row) => {
    const subscription = row.parent?.subscription_details?.subscription;
    return (
      !row.livemode &&
      row.customer_account === original.customerAccount &&
      (typeof row.customer === "string" ? row.customer : row.customer?.id) ===
        original.customerId &&
      (typeof subscription === "string" ? subscription : subscription?.id) ===
        original.subscriptionId &&
      row.billing_reason === "subscription_cycle" &&
      row.period_end === original.periodEnd
    );
  });
  if (matches.length > 1)
    throw new Error("A unique original native invoice is required.");
  return matches[0] ?? null;
}
