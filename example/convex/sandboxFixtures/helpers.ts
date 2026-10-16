import { SANDBOX_DISPUTES, SANDBOX_REFUNDS, SANDBOX_SALES } from "./plan";

export const TASKS = [
  { kind: "plans" as const },
  { kind: "catalog" as const },
  ...SANDBOX_SALES.map((_, index) => ({ kind: "sale" as const, index })),
  ...SANDBOX_REFUNDS.map((_, index) => ({ kind: "refund" as const, index })),
  ...SANDBOX_DISPUTES.map((_, index) => ({
    kind: "disputeSale" as const,
    index,
  })),
  ...SANDBOX_DISPUTES.map((_, index) => ({
    kind: "disputeOutcome" as const,
    index,
  })),
  { kind: "subscription" as const },
  ...["maya@example.com", "sasha@example.com", "avery@example.com"].map(
    (email) => ({ kind: "payout" as const, email }),
  ),
];
