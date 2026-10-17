import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import type { ProcessingCostContext } from "../settlement/processingCosts.js";
import type { VerifiedSale } from "../settlement/verifiedSale.js";
import {
  financialRetryDecision,
  processingCostOutcome,
  readFinancialOutcomeError,
  throwFinancialOutcome,
  verifiedSaleOutcome,
} from "./index.js";

const policy = { maxRetries: 10, initialDelayMs: 1000, maxDelayMs: 60000 };
const pending = {
  status: "not_ready",
  reason: "fee_pending",
  retryable: true,
} as const;

describe("legacy readiness adapters", () => {
  it.each([
    ["payment_processing", "provider_pending"],
    ["charge_unavailable", "provider_pending"],
    ["processing_fee_unavailable", "fee_pending"],
    ["invoice_not_paid", "provider_pending"],
  ])(
    "converts verified sale %s without using English messages",
    (reason, mapped) => {
      expect(
        verifiedSaleOutcome({ status: "pending", reason, retryable: true }),
      ).toEqual({
        status: "not_ready",
        reason: mapped,
        retryable: true,
      });
    },
  );
  it.each(["payment_not_succeeded", "charge_refunded_or_disputed"])(
    "rejects terminal sale reason %s even if a caller marks it retryable",
    (reason) => {
      expect(
        verifiedSaleOutcome({ status: "not_payable", reason, retryable: true }),
      ).toEqual({
        status: "rejected",
        reason: "payment_not_payable",
        retryable: false,
      });
    },
  );
  it("fails closed for unrecognized sale reasons and disabled retry flags", () => {
    for (const sale of [
      {
        status: "pending",
        reason: "processing fees are not available yet",
        retryable: true,
      },
      { status: "pending", reason: "payment_processing", retryable: false },
    ] as VerifiedSale[]) {
      expect(verifiedSaleOutcome(sale)).toEqual({
        status: "rejected",
        reason: "unsupported_source",
        retryable: false,
      });
    }
  });
  it("retains the complete ready sale without changing the legacy object", () => {
    const sale: VerifiedSale = {
      status: "ready",
      paymentIntentId: "pi_one",
      chargeId: "ch_one",
      gross: 100,
      processingFee: 3,
      currency: "usd",
      metadata: {},
    };
    expect(verifiedSaleOutcome(sale)).toEqual({ status: "ready", value: sale });
  });
  it.each([
    ["charge_unavailable", "provider_pending"],
    ["refund_pending", "provider_pending"],
    ["charge_transaction_unavailable", "fee_pending"],
    ["refund_transaction_unavailable", "fee_pending"],
    ["refund_failure_transaction_unavailable", "fee_pending"],
    ["dispute_transactions_unavailable", "fee_pending"],
    ["dispute_reinstatement_unavailable", "fee_pending"],
  ] as const)("converts processing cost %s", (reason, mapped) => {
    expect(
      processingCostOutcome({
        status: "not_ready",
        paymentIntentId: "pi_one",
        reason,
      }),
    ).toEqual({ status: "not_ready", reason: mapped, retryable: true });
  });
  it.each([
    ["payment_not_succeeded", "payment_not_payable"],
    ["currency_mismatch", "currency_mismatch"],
  ] as const)(
    "rejects cost %s without scheduling more financial actions",
    (reason, mapped) => {
      expect(
        processingCostOutcome({
          status: "not_ready",
          paymentIntentId: "pi_one",
          reason,
        }),
      ).toEqual({ status: "rejected", reason: mapped, retryable: false });
    },
  );
  it("preserves ready processing cost evidence", () => {
    const cost: ProcessingCostContext = {
      status: "ready",
      paymentIntentId: "pi_one",
      chargeId: "ch_one",
      currency: "usd",
      gross: 100,
      metadata: {},
      processingFee: 3,
      refundFeeAdjustment: 0,
      disputeFeeAdjustment: 0,
      netFees: 3,
      refundedPrincipal: 0,
      disputedPrincipal: 0,
      principalReturned: 0,
      refunds: [],
      disputes: [],
      transactions: [],
    };
    expect(processingCostOutcome(cost)).toEqual({
      status: "ready",
      value: cost,
    });
  });
});

describe("bounded financial retries", () => {
  it("caps exponential delay and permits exactly the selected retry count", () => {
    expect(
      Array.from({ length: 10 }, (_, attempt) =>
        financialRetryDecision(pending, attempt, policy),
      ),
    ).toEqual(
      [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000].map(
        (delayMs, attempt) => ({
          status: "retry",
          delayMs,
          nextAttempt: attempt + 1,
        }),
      ),
    );
    expect(financialRetryDecision(pending, 10, policy)).toEqual({
      status: "stop",
      reason: "exhausted",
    });
    expect(financialRetryDecision(pending, 11, policy)).toEqual({
      status: "stop",
      reason: "exhausted",
    });
  });
  it("allows zero retries", () => {
    expect(
      financialRetryDecision(pending, 0, { ...policy, maxRetries: 0 }),
    ).toEqual({ status: "stop", reason: "exhausted" });
  });
  it.each([
    { status: "conflict", reason: "scope_busy", retryable: false },
    { status: "conflict", reason: "revision_changed", retryable: false },
    { status: "conflict", reason: "identity_changed", retryable: false },
    { status: "rejected", reason: "invalid_scope", retryable: false },
    { status: "rejected", reason: "policy_invalid", retryable: false },
    { status: "unknown", reason: "provider_outcome_unknown", retryable: false },
    { status: "unknown", reason: "history_incomplete", retryable: false },
    { status: "ready", value: {} },
  ] as const)("never retries $status/$reason", (outcome) => {
    expect(financialRetryDecision(outcome, 0, policy)).toEqual({
      status: "stop",
      reason: "not_retryable",
    });
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid attempts %s",
    (attempt) => {
      expect(() => financialRetryDecision(pending, attempt, policy)).toThrow();
    },
  );
  it.each([
    { maxRetries: -1 },
    { maxRetries: 21 },
    { maxRetries: 0.5 },
    { initialDelayMs: 0 },
    { initialDelayMs: NaN },
    { maxDelayMs: Infinity },
    { maxDelayMs: 86400001 },
    { initialDelayMs: 60001 },
  ])("rejects invalid policy %j", (invalid) => {
    expect(() =>
      financialRetryDecision(pending, 0, { ...policy, ...invalid }),
    ).toThrow();
  });
});

describe("serializable financial errors", () => {
  it("round trips only a validated nonsecret outcome through Convex data", () => {
    let caught: unknown;
    try {
      throwFinancialOutcome(pending);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect(readFinancialOutcomeError(caught)).toEqual(pending);
    const serialized = JSON.parse(
      JSON.stringify((caught as { data: unknown }).data),
    );
    expect(readFinancialOutcomeError({ data: serialized })).toEqual(pending);
    expect(serialized).toEqual({ code: "FINANCIAL_OUTCOME", outcome: pending });
  });
  it.each([
    new Error(
      "Stripe processing fees are not available yet; retry settlement.",
    ),
    {
      data: {
        code: "STRIPE_API_ERROR",
        message: "processing fees are not available",
      },
    },
    {
      data: {
        code: "FINANCIAL_OUTCOME",
        outcome: { ...pending, retryable: false },
      },
    },
    {
      data: {
        code: "FINANCIAL_OUTCOME",
        outcome: { ...pending, reason: "arbitrary" },
      },
    },
    {
      data: {
        code: "FINANCIAL_OUTCOME",
        outcome: { ...pending, secret: "redacted" },
      },
    },
    null,
    "not_ready",
  ])(
    "does not infer retryability from unrelated or malformed errors",
    (error) => {
      expect(readFinancialOutcomeError(error)).toBeNull();
    },
  );
});
