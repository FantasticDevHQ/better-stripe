import type Stripe from "stripe";
import type { PayoutStatus } from "../../component/connect/validators.js";
export type RecipientPayoutReceiptOptions = {
  accountId: string;
  stripePayoutId: string;
  /** Required when adopting a provider payout into a previously attempted claim. */
  operationKey?: string;
};
export type PayoutReceiptTransaction = {
  id: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  status: "available" | "pending";
  created: number;
  availableOn: number;
  type: string;
};
export type RecipientPayoutReceipt =
  | {
      status: "not_ready";
      accountId: string;
      stripePayoutId: string;
      reason:
        | "debit_unavailable"
        | "debit_pending"
        | "return_unavailable"
        | "return_pending"
        | "provider_changed"
        | "reversal_allocation_required"
        | "currency_allocation_required";
    }
  | {
      status: "ready";
      accountId: string;
      stripePayoutId: string;
      operationKey?: string;
      amount: number;
      currency: string;
      providerStatus: PayoutStatus;
      automatic: boolean;
      method: string;
      type: string;
      sourceType: string;
      destinationId: string;
      created: number;
      arrivalDate: number;
      debit: PayoutReceiptTransaction;
      credit?: PayoutReceiptTransaction;
      returnedPrincipal: number;
      returnedNet: number;
      observedAt: number;
    };
function id(value: unknown) {
  return typeof value === "string"
    ? value
    : value &&
        typeof value === "object" &&
        "id" in value &&
        typeof value.id === "string"
      ? value.id
      : undefined;
}
function safeInteger(value: number) {
  if (!Number.isSafeInteger(value))
    throw new Error(
      "Payout receipt requires safe integer amounts and timestamps.",
    );
  return value;
}
function timestamp(value: number) {
  if (safeInteger(value) < 0)
    throw new Error("Payout receipt timestamp is invalid.");
  return value;
}
function currency(value: string) {
  if (value.length !== 3 || !/^[a-z]{3}$/.test(value))
    throw new Error("Payout receipt currency is invalid.");
}
function fingerprint(p: Stripe.Payout) {
  return JSON.stringify([
    p.id,
    p.amount,
    p.currency,
    p.status,
    p.automatic,
    p.method,
    p.type,
    p.source_type,
    id(p.destination),
    id(p.balance_transaction),
    id(p.failure_balance_transaction),
    id(p.reversed_by),
    p.created,
    p.arrival_date,
    p.metadata?.bsPayoutClaim,
  ]);
}
function transaction(
  t: Stripe.BalanceTransaction,
  expectedId: string,
  payoutId: string,
  amount: number,
  types: string[],
): PayoutReceiptTransaction {
  if (
    t.id !== expectedId ||
    id(t.source) !== payoutId ||
    t.amount !== amount ||
    !types.includes(t.type)
  )
    throw new Error(
      "Payout transaction receipt identity or principal does not match.",
    );
  safeInteger(t.amount);
  safeInteger(t.fee);
  safeInteger(t.net);
  if (safeInteger(t.amount - t.fee) !== t.net)
    throw new Error("Payout transaction receipt net amount does not match.");
  if (
    !["available", "pending"].includes(t.status) ||
    ("balance_type" in t && t.balance_type !== "payments")
  )
    throw new Error("Payout transaction receipt balance is unsupported.");
  currency(t.currency);
  return {
    id: t.id,
    amount: t.amount,
    fee: t.fee,
    net: t.net,
    currency: t.currency,
    status: t.status as "available" | "pending",
    created: timestamp(t.created),
    availableOn: timestamp(t.available_on),
    type: t.type,
  };
}
/**
 * Read-only provider receipts, not unpaid entitlement or authorization to release
 * a reservation. Fees remain separate from principal and must be accounted for
 * by the payout/recovery ledger. Manual payout receipts do not identify the
 * original transfers that funded them. Host authorizes access to this account.
 */
export async function getRecipientPayoutReceipt(
  stripe: Stripe,
  options: RecipientPayoutReceiptOptions,
): Promise<RecipientPayoutReceipt> {
  const scope = {
    accountId: options.accountId,
    stripePayoutId: options.stripePayoutId,
  };
  if (
    !/^acct_\w+$/.test(scope.accountId) ||
    scope.accountId.trim() !== scope.accountId ||
    scope.accountId.length > 80 ||
    !/^po_\w+$/.test(scope.stripePayoutId) ||
    scope.stripePayoutId.trim() !== scope.stripePayoutId ||
    scope.stripePayoutId.length > 100
  )
    throw new Error("Invalid recipient payout identity.");
  if (
    options.operationKey !== undefined &&
    (!options.operationKey.trim() ||
      options.operationKey.length > 180 ||
      /[\r\n]/.test(options.operationKey))
  )
    throw new Error("Invalid payout claim identity.");
  const request = { stripeAccount: scope.accountId };
  const readPayout = () =>
    stripe.payouts.retrieve(scope.stripePayoutId, {}, request);
  const payout = await readPayout();
  if (payout.id !== scope.stripePayoutId)
    throw new Error("Provider payout identity does not match.");
  if (safeInteger(payout.amount) <= 0)
    throw new Error("Payout receipt principal is invalid.");
  currency(payout.currency);
  timestamp(payout.created);
  timestamp(payout.arrival_date);
  if (
    !["pending", "in_transit", "paid", "failed", "canceled"].includes(
      payout.status,
    ) ||
    typeof payout.automatic !== "boolean" ||
    !["standard", "instant"].includes(payout.method) ||
    !["bank_account", "card"].includes(payout.type) ||
    !["card", "bank_account", "fpx"].includes(payout.source_type) ||
    !id(payout.destination)
  )
    throw new Error("Payout receipt state is unsupported.");
  if (
    options.operationKey !== undefined &&
    payout.metadata?.bsPayoutClaim !== options.operationKey
  )
    throw new Error("Provider payout claim identity does not match.");
  if (
    options.operationKey !== undefined &&
    (payout.automatic ||
      payout.method !== "standard" ||
      payout.type !== "bank_account")
  )
    throw new Error(
      "Provider payout does not match a standard manual bank claim.",
    );
  if (payout.reversed_by != null)
    return {
      status: "not_ready",
      ...scope,
      reason: "reversal_allocation_required",
    };
  const debitId = id(payout.balance_transaction);
  if (!debitId)
    return { status: "not_ready", ...scope, reason: "debit_unavailable" };
  const debit = transaction(
    await stripe.balanceTransactions.retrieve(debitId, {}, request),
    debitId,
    payout.id,
    -payout.amount,
    ["payout"],
  );
  if (debit.currency !== payout.currency)
    return {
      status: "not_ready",
      ...scope,
      reason: "currency_allocation_required",
    };
  if (
    debit.status !== "available" ||
    debit.availableOn > Math.floor(Date.now() / 1000)
  )
    return { status: "not_ready", ...scope, reason: "debit_pending" };
  let credit: PayoutReceiptTransaction | undefined;
  if (payout.status === "failed" || payout.status === "canceled") {
    const creditId = id(payout.failure_balance_transaction);
    if (!creditId)
      return { status: "not_ready", ...scope, reason: "return_unavailable" };
    if (creditId === debitId)
      throw new Error(
        "Payout return receipt cannot also be the original debit.",
      );
    credit = transaction(
      await stripe.balanceTransactions.retrieve(creditId, {}, request),
      creditId,
      payout.id,
      payout.amount,
      ["payout_failure", "payout_cancel"],
    );
    if (credit.currency !== payout.currency)
      return {
        status: "not_ready",
        ...scope,
        reason: "currency_allocation_required",
      };
    if (
      credit.status !== "available" ||
      credit.availableOn > Math.floor(Date.now() / 1000)
    )
      return { status: "not_ready", ...scope, reason: "return_pending" };
  } else if (payout.failure_balance_transaction != null) {
    return { status: "not_ready", ...scope, reason: "provider_changed" };
  }
  const verified = await readPayout();
  if (fingerprint(payout) !== fingerprint(verified))
    return { status: "not_ready", ...scope, reason: "provider_changed" };
  return {
    status: "ready",
    ...scope,
    ...(payout.metadata?.bsPayoutClaim
      ? { operationKey: payout.metadata.bsPayoutClaim }
      : {}),
    amount: payout.amount,
    currency: payout.currency,
    providerStatus: payout.status as PayoutStatus,
    automatic: payout.automatic,
    method: payout.method,
    type: payout.type,
    sourceType: payout.source_type,
    destinationId: id(payout.destination)!,
    created: payout.created,
    arrivalDate: payout.arrival_date,
    debit,
    ...(credit ? { credit } : {}),
    returnedPrincipal: credit?.amount ?? 0,
    returnedNet: credit?.net ?? 0,
    observedAt: Date.now(),
  };
}
