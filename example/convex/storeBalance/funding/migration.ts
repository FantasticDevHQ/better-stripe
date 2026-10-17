import type { Doc } from "../../_generated/dataModel";

/** Version used by the legacy example adapter, not the current SDK default. */
export const LEGACY_FUNDING_API_VERSION = "2026-09-30.preview";
export const fundingScope = (sellerId: string, subscriptionId: string) =>
  `example:store-balance:${sellerId}:${subscriptionId}`;

/** Compact checkpoint; the original source row and component payload are retained. */
export async function legacySnapshot(row: Doc<"storeBalanceFunding">) {
  const value = [
    row._id,
    row.sellerId,
    row.subscriptionId,
    row.enabled,
    row.paymentMethodId,
    row.previousPaymentMethodId ?? null,
    row.previousPaymentMethodTypes ?? null,
    row.consentAt,
    row.operationVersion ?? null,
    row.operationPending ?? null,
    row.targetEnabled ?? null,
  ];
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
