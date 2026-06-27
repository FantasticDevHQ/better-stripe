/**
 * A Stripe object that may be owned by a customer. The V2 Accounts API exposes
 * the owner as `customer_account` (`acct_…`); legacy V1 objects use `customer`
 * (`cus_…`), either as a string id or an expanded object.
 */
export type CustomerOwned = {
  customer_account?: string | null;
  customer?: string | { id?: string | null } | null;
};

/**
 * Resolve the owning account of a Stripe object, preferring the V2
 * `customer_account` (`acct_…`) over the legacy `customer` (`cus_…`).
 *
 * Used by webhook processors and Connect helpers so V2 customer-configured
 * accounts are attributed to their `acct_…` id rather than the V1 `cus_…` id.
 *
 * @returns the owner id, or `null` when no owner information is present.
 */
export function resolveOwnerAccount(obj: CustomerOwned): string | null {
  if (obj.customer_account) return obj.customer_account;
  if (typeof obj.customer === "string") return obj.customer;
  if (obj.customer && typeof obj.customer === "object" && "id" in obj.customer) {
    return obj.customer.id ?? null;
  }
  return null;
}
