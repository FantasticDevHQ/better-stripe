export interface StoreInvoiceEstimate {
  currency: string;
  total: number;
  nextBillingAt: number;
  lines: {
    id: string;
    description: string;
    amount: number;
    sourceType?: "refund" | "dispute";
  }[];
}
