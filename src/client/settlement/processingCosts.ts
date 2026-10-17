import {
  boundedCostHistory,
  type ProcessingCostHistoryBounds,
} from "./processingCostHistory.js";
import type Stripe from "stripe";

export type ProcessingCostOptions = {
  /** Host authorizes the payment and optional connected-account context. */
  paymentIntentId: string;
  stripeAccountId?: string;
  /** Optional complete-history budgets. Existing callers retain their pagination behavior. */
  historyBounds?: ProcessingCostHistoryBounds;
};
export type ProcessingCostTransaction = {
  id: string;
  sourceId: string;
  sourceType: "charge" | "refund" | "refund_failure" | "dispute";
  currency: string;
  amount: number;
  fee: number;
  net: number;
  created: number;
  feeDetails:
    | {
        type: string;
        amount: number;
        currency: string;
        application: string | null;
        description: string | null;
      }[]
    | null;
};
export type ProcessingCostRecord = {
  id: string;
  status: string;
  amount: number;
  balanceTransactionIds: string[];
};
export type ProcessingCostNotReadyReason =
  | "payment_not_succeeded"
  | "charge_unavailable"
  | "charge_transaction_unavailable"
  | "refund_transaction_unavailable"
  | "refund_failure_transaction_unavailable"
  | "refund_pending"
  | "dispute_transactions_unavailable"
  | "dispute_reinstatement_unavailable"
  | "currency_mismatch";
export type ProcessingCostContext =
  | {
      status: "not_ready";
      paymentIntentId: string;
      reason: ProcessingCostNotReadyReason;
    }
  | {
      status: "ready";
      paymentIntentId: string;
      chargeId: string;
      currency: string;
      gross: number;
      metadata: Record<string, string>;
      processingFee: number;
      refundFeeAdjustment: number;
      disputeFeeAdjustment: number;
      netFees: number;
      refundedPrincipal: number;
      disputedPrincipal: number;
      /** Capped economic principal; raw provider debits remain in transactions. */
      principalReturned: number;
      refunds: ProcessingCostRecord[];
      disputes: ProcessingCostRecord[];
      transactions: ProcessingCostTransaction[];
    };
class NotReady extends Error {
  constructor(readonly reason: ProcessingCostNotReadyReason) {
    super(reason);
  }
}
const id = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;
function integer(value: number) {
  if (!Number.isSafeInteger(value))
    throw new Error("Processing cost amounts and dates must be safe integers.");
  return value;
}
const sum = (values: number[]) => values.reduce((a, b) => integer(a + b), 0);

/** Authoritative read only. Refunded/disputed charges are valid cost sources. */
export async function getProcessingCostContext(
  stripe: Stripe,
  opts: ProcessingCostOptions,
): Promise<ProcessingCostContext> {
  const requestOptions = opts.stripeAccountId
    ? { stripeAccount: opts.stripeAccountId }
    : undefined;
  try {
    const payment = await stripe.paymentIntents.retrieve(
      opts.paymentIntentId,
      { expand: ["latest_charge.balance_transaction"] },
      requestOptions,
    );
    if (payment.status !== "succeeded")
      throw new NotReady("payment_not_succeeded");
    const charge = payment.latest_charge;
    if (!charge || typeof charge === "string")
      throw new NotReady("charge_unavailable");
    if (id(charge.payment_intent) !== payment.id)
      throw new Error("Charge does not belong to the payment.");
    const currency = payment.currency;
    if (charge.currency !== currency) throw new NotReady("currency_mismatch");
    const transactions = new Map<string, ProcessingCostTransaction>();
    async function add(
      value: Stripe.BalanceTransaction | string | null,
      sourceId: string,
      sourceType: ProcessingCostTransaction["sourceType"],
      missing: ProcessingCostNotReadyReason,
    ) {
      if (!value) throw new NotReady(missing);
      const tx =
        typeof value === "string"
          ? await stripe.balanceTransactions.retrieve(value, {}, requestOptions)
          : value;
      if (tx.currency !== currency) throw new NotReady("currency_mismatch");
      [tx.amount, tx.fee, tx.net].forEach(integer);
      if (integer(tx.amount - tx.fee) !== tx.net)
        throw new Error("Provider balance transaction does not reconcile.");
      const existing = transactions.get(tx.id);
      if (
        existing &&
        (existing.sourceId !== sourceId || existing.sourceType !== sourceType)
      )
        throw new Error(
          "Balance transaction belongs to multiple cost sources.",
        );
      const feeDetails =
        tx.fee_details?.map((detail) => {
          if (detail.currency !== currency)
            throw new NotReady("currency_mismatch");
          return {
            type: detail.type,
            amount: integer(detail.amount),
            currency: detail.currency,
            application: detail.application,
            description: detail.description,
          };
        }) ?? null;
      transactions.set(tx.id, {
        id: tx.id,
        sourceId,
        sourceType,
        currency,
        amount: tx.amount,
        fee: tx.fee,
        net: tx.net,
        created: integer(tx.created * 1000),
        feeDetails,
      });
      return tx.id;
    }
    const chargeTransactionId = await add(
      charge.balance_transaction,
      charge.id,
      "charge",
      "charge_transaction_unavailable",
    );
    const original = transactions.get(chargeTransactionId)!;
    const gross = integer(payment.amount_received);
    if (gross < 0 || original.amount !== gross)
      throw new Error("Payment and processed charge amounts do not reconcile.");
    const refunds = new Map<string, ProcessingCostRecord>();
    const refundParams = {
      payment_intent: payment.id,
      limit: 100,
      expand: ["data.balance_transaction", "data.failure_balance_transaction"],
    };
    const refundRows = opts.historyBounds
      ? await boundedCostHistory(
          (cursor, limit) =>
            stripe.refunds.list(
              {
                ...refundParams,
                limit,
                ...(cursor ? { starting_after: cursor } : {}),
              },
              requestOptions,
            ),
          opts.historyBounds,
        )
      : stripe.refunds.list(refundParams, requestOptions);
    for await (const refund of refundRows) {
      if (
        id(refund.charge) !== charge.id ||
        (refund.payment_intent && id(refund.payment_intent) !== payment.id)
      )
        throw new Error("Refund does not belong to the payment charge.");
      if (refund.currency !== currency) throw new NotReady("currency_mismatch");
      if (!["succeeded", "failed", "canceled"].includes(refund.status ?? ""))
        throw new NotReady("refund_pending");
      const amount = integer(refund.amount);
      if (amount < 0) throw new Error("Refund amount must be nonnegative.");
      const ids: string[] = [];
      if (refund.balance_transaction || refund.status === "succeeded")
        ids.push(
          await add(
            refund.balance_transaction,
            refund.id,
            "refund",
            "refund_transaction_unavailable",
          ),
        );
      if (
        refund.failure_balance_transaction ||
        (refund.status === "failed" && refund.balance_transaction)
      )
        ids.push(
          await add(
            refund.failure_balance_transaction ?? null,
            refund.id,
            "refund_failure",
            "refund_failure_transaction_unavailable",
          ),
        );
      refunds.set(refund.id, {
        id: refund.id,
        status: refund.status!,
        amount,
        balanceTransactionIds: [...new Set(ids)],
      });
    }
    const disputes = new Map<string, ProcessingCostRecord>();
    const disputeParams = { payment_intent: payment.id, limit: 100 };
    const disputeRows = opts.historyBounds
      ? await boundedCostHistory(
          (cursor, limit) =>
            stripe.disputes.list(
              {
                ...disputeParams,
                limit,
                ...(cursor ? { starting_after: cursor } : {}),
              },
              requestOptions,
            ),
          opts.historyBounds,
        )
      : stripe.disputes.list(disputeParams, requestOptions);
    for await (const dispute of disputeRows) {
      if (
        id(dispute.charge) !== charge.id ||
        (dispute.payment_intent && id(dispute.payment_intent) !== payment.id)
      )
        throw new Error("Dispute does not belong to the payment charge.");
      if (dispute.currency !== currency)
        throw new NotReady("currency_mismatch");
      if (
        !dispute.balance_transactions.length &&
        !dispute.status.startsWith("warning_")
      )
        throw new NotReady("dispute_transactions_unavailable");
      const amount = integer(dispute.amount);
      if (amount < 0) throw new Error("Dispute amount must be nonnegative.");
      const ids: string[] = [];
      for (const tx of dispute.balance_transactions)
        ids.push(
          await add(
            tx,
            dispute.id,
            "dispute",
            "dispute_transactions_unavailable",
          ),
        );
      if (
        dispute.status === "won" &&
        sum([...new Set(ids)].map((txId) => transactions.get(txId)!.amount)) < 0
      )
        throw new NotReady("dispute_reinstatement_unavailable");
      disputes.set(dispute.id, {
        id: dispute.id,
        status: dispute.status,
        amount,
        balanceTransactionIds: [...new Set(ids)],
      });
    }
    const all = [...transactions.values()];
    const refundFeeAdjustment = sum(
      all
        .filter(
          (tx) =>
            tx.sourceType === "refund" || tx.sourceType === "refund_failure",
        )
        .map((tx) => tx.fee),
    );
    const disputeFeeAdjustment = sum(
      all.filter((tx) => tx.sourceType === "dispute").map((tx) => tx.fee),
    );
    const refundedPrincipal = sum(
      [...refunds.values()]
        .filter((refund) => refund.status === "succeeded")
        .map((refund) => refund.amount),
    );
    const disputedPrincipal = sum(
      [...disputes.values()].map((dispute) =>
        Math.max(
          0,
          -sum(
            dispute.balanceTransactionIds.map(
              (txId) => transactions.get(txId)!.amount,
            ),
          ),
        ),
      ),
    );
    return {
      status: "ready",
      paymentIntentId: payment.id,
      chargeId: charge.id,
      currency,
      gross,
      metadata: payment.metadata,
      processingFee: original.fee,
      refundFeeAdjustment,
      disputeFeeAdjustment,
      netFees: sum([original.fee, refundFeeAdjustment, disputeFeeAdjustment]),
      refundedPrincipal,
      disputedPrincipal,
      principalReturned: Math.min(
        gross,
        sum([refundedPrincipal, disputedPrincipal]),
      ),
      refunds: [...refunds.values()],
      disputes: [...disputes.values()],
      transactions: all,
    };
  } catch (error) {
    if (error instanceof NotReady)
      return {
        status: "not_ready",
        paymentIntentId: opts.paymentIntentId,
        reason: error.reason,
      };
    throw error;
  }
}
