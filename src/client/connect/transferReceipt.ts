import { transferFingerprint as ledgerFingerprint } from "../../component/payoutRelease/helpers.js";
import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { transferDocValidator } from "../../component/connect/validators.js";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
type LedgerTransfer = Infer<typeof transferDocValidator>;
export type TransferReceiptOptions = {
  accountId: string;
  stripeTransferId: string;
  maxRequests?: number;
};
export type TransferReceiptTransaction = {
  id: string;
  sourceId: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  created: number;
  /** Unix seconds, as returned by Stripe. */
  availableOn: number;
  status: "available" | "pending";
  type: string;
};
export type TransferReceiptNotReadyReason =
  | "not_in_ledger"
  | "transfer_pending"
  | "receipt_unavailable"
  | "reversal_pending"
  | "history_incomplete"
  | "currency_allocation_required"
  | "provider_changed"
  | "ledger_changed";
export type TransferFundingReceipt =
  | {
      status: "not_ready";
      accountId: string;
      stripeTransferId: string;
      reason: TransferReceiptNotReadyReason;
    }
  | {
      status: "ready";
      accountId: string;
      stripeTransferId: string;
      destinationPaymentId: string;
      sourceAmount: number;
      sourceCurrency: string;
      settlementCurrency: string;
      providerReversedAmount: number;
      totalNet: number;
      /** Signed source contribution; previous payouts are not allocated here. */
      matureNet: number;
      pendingCredits: number;
      role?: "store" | "affiliate" | "other";
      reinstatement: boolean;
      transactions: TransferReceiptTransaction[];
      /** Snapshot observation time in milliseconds. */
      observedAt: number;
    };
class NotReady extends Error {
  constructor(readonly reason: TransferReceiptNotReadyReason) {
    super(reason);
  }
}
const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
function integer(value: number) {
  if (!Number.isSafeInteger(value))
    throw new Error("Receipt amounts must be safe integers.");
  return value;
}
const add = (a: number, b: number) => integer(a + b);
function fingerprint(t: Stripe.Transfer) {
  return JSON.stringify([
    t.id,
    id(t.destination),
    id(t.destination_payment),
    id(t.source_transaction),
    t.amount,
    t.currency,
    t.amount_reversed,
    t.metadata?.bsReinstateOf,
  ]);
}
/** Recipient-scoped received credit. Previous payouts are deliberately not allocated here. */
export async function getTransferFundingReceipt(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: TransferReceiptOptions,
): Promise<TransferFundingReceipt> {
  const max = opts.maxRequests ?? 20;
  if (!Number.isInteger(max) || max < 1 || max > 100)
    throw new Error("Receipt request budget must be between 1 and 100.");
  if (
    !/^acct_\w+$/.test(opts.accountId) ||
    !/^tr_\w+$/.test(opts.stripeTransferId)
  )
    throw new Error("Invalid recipient transfer identity.");
  const scope = {
    accountId: opts.accountId,
    stripeTransferId: opts.stripeTransferId,
  };
  const read = () =>
    ctx.runQuery(
      componentRef(component, "connect/queries/getTransferByStripeId"),
      { stripeTransferId: opts.stripeTransferId },
    ) as Promise<LedgerTransfer | null>;
  const ledger = await read();
  if (!ledger)
    return { status: "not_ready", ...scope, reason: "not_in_ledger" };
  if (
    ledger.destinationAccountId !== opts.accountId ||
    ledger.stripeTransferId !== opts.stripeTransferId
  )
    throw new Error("Transfer ledger identity does not match the recipient.");
  if (!["paid", "reversed"].includes(ledger.status))
    return { status: "not_ready", ...scope, reason: "transfer_pending" };
  let requests = 0;
  async function request<T>(fn: () => Promise<T>): Promise<T> {
    if (requests++ >= max) throw new NotReady("history_incomplete");
    return fn();
  }
  async function scan<T extends { id: string }>(
    fn: (cursor?: string) => Promise<{ data: T[]; has_more: boolean }>,
  ): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await request(() => fn(cursor));
      rows.push(...page.data);
      if (!page.has_more) return rows;
      const next = page.data[page.data.length - 1]?.id;
      if (!next || next === cursor) throw new NotReady("history_incomplete");
      cursor = next;
    }
  }
  try {
    const transfer = await request(() =>
      stripe.transfers.retrieve(opts.stripeTransferId),
    );
    const destinationPaymentId = id(transfer.destination_payment);
    if (
      transfer.id !== ledger.stripeTransferId ||
      id(transfer.destination) !== ledger.destinationAccountId ||
      transfer.amount !== ledger.amount ||
      transfer.currency !== ledger.currency ||
      !destinationPaymentId
    )
      throw new Error(
        "Provider transfer identity or provenance does not match the ledger.",
      );
    const source = id(transfer.source_transaction);
    if (
      ledger.sourceChargeId &&
      source !== ledger.sourceChargeId &&
      !(
        ledger.reinstatement &&
        !source &&
        transfer.metadata?.bsReinstateOf === ledger.sourceChargeId
      )
    )
      throw new Error("Transfer source provenance does not match the ledger.");
    integer(transfer.amount);
    integer(transfer.amount_reversed);
    if (
      transfer.amount <= 0 ||
      transfer.amount_reversed < 0 ||
      transfer.amount_reversed > transfer.amount
    )
      throw new Error("Invalid transfer receipt amount.");
    for (const amount of [
      ledger.reversedAmount ?? 0,
      ledger.reversalClaimedAmount ?? 0,
    ]) {
      integer(amount);
      if (amount < 0 || amount > transfer.amount)
        throw new Error("Invalid ledger reversal amount.");
    }
    if (
      Math.max(ledger.reversedAmount ?? 0, ledger.reversalClaimedAmount ?? 0) >
      transfer.amount_reversed
    )
      throw new NotReady("reversal_pending");
    const payment = await request(() =>
      stripe.charges.retrieve(
        destinationPaymentId,
        {},
        { stripeAccount: opts.accountId },
      ),
    );
    if (
      payment.id !== destinationPaymentId ||
      id(payment.source_transfer) !== transfer.id
    )
      throw new Error(
        "Recipient payment identity does not match the transfer.",
      );
    if (payment.currency !== transfer.currency)
      throw new NotReady("currency_allocation_required");
    if (payment.amount !== transfer.amount)
      throw new Error("Recipient payment amount does not match the transfer.");
    if (
      !payment.paid ||
      payment.status !== "succeeded" ||
      !id(payment.balance_transaction)
    )
      throw new NotReady("receipt_unavailable");
    const records = new Map<string, TransferReceiptTransaction>();
    let settlementCurrency: string | undefined;
    async function receipts(
      sourceId: string,
      primary: { id: string; amount: number; currency: string; sign: 1 | -1 },
    ) {
      const txs = await scan((cursor) =>
        stripe.balanceTransactions.list(
          {
            source: sourceId,
            limit: 100,
            ...(cursor ? { starting_after: cursor } : {}),
          },
          { stripeAccount: opts.accountId },
        ),
      );
      if (!txs.length) throw new NotReady("receipt_unavailable");
      for (const t of txs) {
        if (id(t.source) !== sourceId)
          throw new Error(
            "Recipient receipt identity does not match its source.",
          );
        for (const amount of [
          t.amount,
          t.fee,
          t.net,
          t.created,
          t.available_on,
        ])
          integer(amount);
        if (
          t.fee < 0 ||
          t.net !== integer(t.amount - t.fee) ||
          t.created < 0 ||
          t.available_on < 0
        )
          throw new Error("Invalid recipient receipt amount.");
        if (t.status !== "available" && t.status !== "pending")
          throw new NotReady("receipt_unavailable");
        if (!/^[a-z]{3}$/.test(t.currency))
          throw new Error("Invalid receipt currency.");
        if ("balance_type" in t && t.balance_type !== "payments")
          throw new NotReady("currency_allocation_required");
        if (settlementCurrency && settlementCurrency !== t.currency)
          throw new NotReady("currency_allocation_required");
        settlementCurrency = t.currency;
        if (t.id === primary.id) {
          if (
            t.currency === primary.currency &&
            t.amount !== primary.sign * primary.amount
          )
            throw new Error(
              "Original recipient receipt amount does not match the payment.",
            );
          if (
            t.currency !== primary.currency &&
            (!Number.isFinite(t.exchange_rate) ||
              !t.exchange_rate ||
              t.exchange_rate <= 0)
          )
            throw new NotReady("currency_allocation_required");
        }
        const record: TransferReceiptTransaction = {
          id: t.id,
          sourceId,
          amount: t.amount,
          fee: t.fee,
          net: t.net,
          currency: t.currency,
          created: t.created,
          availableOn: t.available_on,
          status: t.status,
          type: t.type,
        };
        const prior = records.get(t.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(record))
          throw new Error("Conflicting recipient receipt identity.");
        records.set(t.id, record);
      }
      if (!records.has(primary.id)) throw new NotReady("receipt_unavailable");
    }
    await receipts(destinationPaymentId, {
      id: id(payment.balance_transaction)!,
      amount: payment.amount,
      currency: payment.currency,
      sign: 1,
    });
    const reversals = await scan((cursor) =>
      stripe.transfers.listReversals(transfer.id, {
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      }),
    );
    const seenReversals = new Map<string, Stripe.TransferReversal>();
    let reversed = 0;
    for (const r of reversals) {
      if (
        id(r.transfer) !== transfer.id ||
        r.currency !== transfer.currency ||
        !Number.isSafeInteger(r.amount) ||
        r.amount <= 0
      )
        throw new Error("Transfer reversal identity or amount does not match.");
      const prior = seenReversals.get(r.id);
      if (prior) {
        if (
          JSON.stringify([
            prior.amount,
            id(prior.destination_payment_refund),
          ]) !== JSON.stringify([r.amount, id(r.destination_payment_refund)])
        )
          throw new Error("Conflicting reversal receipt identity.");
        continue;
      }
      seenReversals.set(r.id, r);
      reversed = add(reversed, r.amount);
      const refundId = id(r.destination_payment_refund);
      if (!refundId) throw new NotReady("receipt_unavailable");
      const refund = await request(() =>
        stripe.refunds.retrieve(
          refundId,
          {},
          { stripeAccount: opts.accountId },
        ),
      );
      if (
        refund.id !== refundId ||
        id(refund.charge) !== destinationPaymentId ||
        refund.amount !== r.amount ||
        refund.currency !== transfer.currency
      )
        throw new Error(
          "Recipient refund identity does not match its reversal.",
        );
      if (refund.status !== "succeeded") throw new NotReady("reversal_pending");
      const refundTransactionId = id(refund.balance_transaction);
      if (!refundTransactionId) throw new NotReady("receipt_unavailable");
      await receipts(refundId, {
        id: refundTransactionId,
        amount: refund.amount,
        currency: refund.currency,
        sign: -1,
      });
    }
    if (reversed !== transfer.amount_reversed)
      throw new NotReady("provider_changed");
    const latest = await request(() => stripe.transfers.retrieve(transfer.id));
    if (fingerprint(transfer) !== fingerprint(latest))
      throw new NotReady("provider_changed");
    const latestLedger = await read();
    if (
      !latestLedger ||
      ledgerFingerprint(ledger) !== ledgerFingerprint(latestLedger)
    )
      throw new NotReady("ledger_changed");
    let totalNet = 0,
      availableNet = 0,
      pendingCredits = 0,
      pendingDebits = 0;
    const now = Math.floor(Date.now() / 1000);
    const primary = records.get(id(payment.balance_transaction)!)!;
    const primaryPending =
      primary.net > 0 &&
      !(primary.status === "available" && primary.availableOn <= now)
        ? primary.net
        : 0;
    for (const t of records.values()) {
      totalNet = add(totalNet, t.net);
      if (t.status === "available" && t.availableOn <= now)
        availableNet = add(availableNet, t.net);
      else if (t.net > 0) pendingCredits = add(pendingCredits, t.net);
      else pendingDebits = add(pendingDebits, -t.net);
    }
    // Cancel a pending original credit first. Uncovered pending debits reduce
    // mature credit; later positive fee credits never qualify before maturity.
    const canceledPending = Math.min(primaryPending, pendingDebits);
    const matureNet = add(availableNet, -(pendingDebits - canceledPending));
    pendingCredits = add(pendingCredits, -canceledPending);
    return {
      status: "ready",
      ...scope,
      destinationPaymentId,
      sourceAmount: transfer.amount,
      sourceCurrency: transfer.currency,
      settlementCurrency: settlementCurrency!,
      providerReversedAmount: transfer.amount_reversed,
      totalNet,
      matureNet,
      pendingCredits,
      ...(ledger.role ? { role: ledger.role } : {}),
      reinstatement: ledger.reinstatement ?? false,
      transactions: [...records.values()],
      observedAt: Date.now(),
    };
  } catch (error) {
    if (error instanceof NotReady)
      return { status: "not_ready", ...scope, reason: error.reason };
    throw error;
  }
}
