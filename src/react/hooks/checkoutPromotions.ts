export type CheckoutPricing = {
  currency: string;
  /** Provider-observed amounts in the currency's minor units. */
  subtotal: number;
  discount: number;
  total: number;
};
export type CheckoutPromotionResult =
  | { type: "success"; sessionId: string }
  | { type: "error"; message: string; code?: "invalidCode" };

function minorUnits(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("minorUnitsAmount" in value))
    return null;
  const amount = value.minorUnitsAmount;
  return typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount >= 0
    ? amount
    : null;
}
/** Presentation only: no cash, entitlement or original-price authority. */
export function checkoutPricing(checkout: {
  currency?: unknown;
  total?: unknown;
}): CheckoutPricing | null {
  const total = checkout.total;
  if (
    typeof checkout.currency !== "string" ||
    !checkout.currency ||
    !total ||
    typeof total !== "object" ||
    !("subtotal" in total) ||
    !("discount" in total) ||
    !("total" in total)
  )
    return null;
  const subtotal = minorUnits(total.subtotal);
  const discount = minorUnits(total.discount);
  const amount = minorUnits(total.total);
  return subtotal === null || discount === null || amount === null
    ? null
    : {
        currency: checkout.currency,
        subtotal,
        discount,
        total: amount,
      };
}
/** Delegate once; callers keep their existing actor/session workflow scope. */
export async function updatePromotion(
  sessionId: string,
  action: () => Promise<unknown>,
): Promise<CheckoutPromotionResult> {
  const unconfirmed: CheckoutPromotionResult = {
    type: "error",
    message: "Promotion code update failed",
  };
  try {
    const result = await action();
    if (!result || typeof result !== "object" || !("type" in result))
      return unconfirmed;
    if (result.type === "success" && "session" in result) {
      const session = result.session;
      return session &&
        typeof session === "object" &&
        "id" in session &&
        session.id === sessionId
        ? { type: "success", sessionId }
        : unconfirmed;
    }
    if (result.type === "error" && "error" in result) {
      const error = result.error;
      if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string" &&
        error.message
      ) {
        return {
          type: "error",
          message: error.message,
          ...("code" in error && error.code === "invalidCode"
            ? { code: "invalidCode" as const }
            : {}),
        };
      }
    }
    return unconfirmed;
  } catch {
    return unconfirmed;
  }
}
