import type { SplitRecipientRole } from "../../component/lib/fees.js";

/**
 * Refund actor scoping (BTS-35).
 *
 * The app authenticates the caller and hands the library an actor identity; the
 * library — not the app — enforces who may refund what. A platform admin may
 * refund any sale. A seller may refund only sales whose money was routed to
 * their own connected account as the *merchant* of the sale: the destination of
 * a destination charge, or the `store` leg of a separate-charges (split) sale.
 *
 * A split sale's minor legs (`affiliate` / `other` commission recipients) are
 * deliberately NOT authorized. Refunding a split charge is webhook-driven
 * pro-rata clawback from *every* recipient (`reverseTransfersForRefund`), so
 * authorizing a minor leg would let an affiliate unwind the store's entire sale
 * and pull money back from co-recipients who never consented. Those refunds are
 * admin-only.
 */

/** Who is initiating a refund. `accountId` is the seller's `acct_…` id. */
export type RefundActor =
  | { type: "admin" }
  | { type: "seller"; accountId: string };

/**
 * The subset of a payment's routing needed to authorize a seller refund, read
 * off the component's `payments` ledger (the authoritative record of where the
 * money actually went at capture time). `role` is threaded through from each
 * split leg so the merchant (`store`) can be distinguished from minor
 * commission recipients.
 */
export type RefundRouting = {
  /** Destination-charge seller account (`transfer_data.destination`). */
  destinationAccountId?: string;
  /** Separate-charges split legs; only the `store` leg may refund the sale. */
  splitRecipients?: readonly {
    destinationAccountId: string;
    role: SplitRecipientRole;
  }[];
};

/**
 * Whether `actor` is allowed to refund a payment with the given `routing`.
 * Admins are unrestricted. A seller is authorized only when the payment was
 * routed to their account as the merchant of the sale — either the destination
 * charge's seller, or the `store` leg of a split sale. Affiliate / `other`
 * split legs are never authorized (admin-only). A seller can never refund a
 * payment with no routing to match against (fail closed).
 */
export function isRefundAuthorized(
  actor: RefundActor,
  routing: RefundRouting,
): boolean {
  if (actor.type === "admin") return true;
  const { accountId } = actor;
  if (routing.destinationAccountId === accountId) return true;
  return (routing.splitRecipients ?? []).some(
    (r) => r.role === "store" && r.destinationAccountId === accountId,
  );
}
