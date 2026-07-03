/**
 * Refund actor scoping (BTS-35).
 *
 * The app authenticates the caller and hands the library an actor identity; the
 * library — not the app — enforces who may refund what. A platform admin may
 * refund any sale. A seller may refund only sales whose money was routed to
 * their own connected account: the destination of a destination charge, or one
 * of the recipients of a separate-charges (split) sale.
 */

/** Who is initiating a refund. `accountId` is the seller's `acct_…` id. */
export type RefundActor =
  | { type: "admin" }
  | { type: "seller"; accountId: string };

/**
 * The subset of a payment's routing needed to authorize a seller refund, read
 * off the component's `payments` ledger (the authoritative record of where the
 * money actually went at capture time).
 */
export type RefundRouting = {
  /** Destination-charge seller account (`transfer_data.destination`). */
  destinationAccountId?: string;
  /** Separate-charges split legs; a seller owns the sale if they're a leg. */
  splitRecipients?: readonly { destinationAccountId: string }[];
};

/**
 * Whether `actor` is allowed to refund a payment with the given `routing`.
 * Admins are unrestricted. A seller is authorized only when the payment was
 * routed to their account — either as the destination charge's seller or as one
 * of the split recipients. A seller can never refund a payment with no routing
 * to match against (fail closed).
 */
export function isRefundAuthorized(
  actor: RefundActor,
  routing: RefundRouting,
): boolean {
  if (actor.type === "admin") return true;
  const { accountId } = actor;
  if (routing.destinationAccountId === accountId) return true;
  return (routing.splitRecipients ?? []).some(
    (r) => r.destinationAccountId === accountId,
  );
}
