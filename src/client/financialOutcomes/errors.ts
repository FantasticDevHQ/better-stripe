import { ConvexError } from "convex/values";
import {
  financialUnavailableSchema,
  type FinancialUnavailable,
} from "./contracts.js";

/** Carry only a validated outcome across a Convex action boundary. */
export function throwFinancialOutcome(outcome: FinancialUnavailable): never {
  const safe = financialUnavailableSchema.parse(outcome);
  throw new ConvexError({ code: "FINANCIAL_OUTCOME", outcome: safe });
}

/** Convex structured data only. Never parse an exception's English message. */
export function readFinancialOutcomeError(
  error: unknown,
): FinancialUnavailable | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = error.data;
  if (
    !data ||
    typeof data !== "object" ||
    !("code" in data) ||
    data.code !== "FINANCIAL_OUTCOME" ||
    !("outcome" in data)
  )
    return null;
  const parsed = financialUnavailableSchema.safeParse(data.outcome);
  return parsed.success ? parsed.data : null;
}
