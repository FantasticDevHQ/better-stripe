type Evidence = {
  status?: string;
  invoiceId?: string;
  revenue?: Array<{
    cash?: { status?: string };
    settlement?: { status?: string } | null;
  }>;
};
export function assertDemoCleanupReady(
  value: Evidence | null,
): asserts value is Evidence & { invoiceId: string } {
  if (value?.status !== "paid" || !value.invoiceId || !value.revenue?.length)
    throw new Error(
      "A verified paid original invoice and cash source are required before cleanup.",
    );
  for (const row of value.revenue) {
    if (row.cash?.status !== "ready")
      throw new Error(
        "Original cash reconciliation is required before cleanup.",
      );
    if (row.settlement && row.settlement.status !== "settled")
      throw new Error(
        "Original settlement reconciliation is required before cleanup.",
      );
  }
}
