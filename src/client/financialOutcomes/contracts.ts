import { z } from "zod";

/** Safe to persist. Provider messages, credentials and financial payloads stay out. */
export const financialUnavailableSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("not_ready"),
      reason: z.enum(["provider_pending", "fee_pending", "history_incomplete"]),
      retryable: z.literal(true),
    })
    .strict(),
  z
    .object({
      status: z.literal("conflict"),
      reason: z.enum(["scope_busy", "revision_changed", "identity_changed"]),
      retryable: z.literal(false),
    })
    .strict(),
  z
    .object({
      status: z.literal("rejected"),
      reason: z.enum([
        "invalid_scope",
        "unsupported_source",
        "policy_invalid",
        "payment_not_payable",
        "currency_mismatch",
      ]),
      retryable: z.literal(false),
    })
    .strict(),
  z
    .object({
      status: z.literal("unknown"),
      reason: z.enum(["provider_outcome_unknown", "history_incomplete"]),
      retryable: z.literal(false),
    })
    .strict(),
]);

export type FinancialUnavailable = z.infer<typeof financialUnavailableSchema>;
export type FinancialOutcome<T> =
  { status: "ready"; value: T } | FinancialUnavailable;
