import type {
  CheckoutSessionState,
  CheckoutPricing,
  CheckoutPromotionResult,
} from "@fantastic.dev/better-stripe/react";

export async function composeCustomForm(state: CheckoutSessionState) {
  if (state.type !== "success") return;
  const observed: CheckoutPricing | null = state.pricing;
  const applied: CheckoutPromotionResult =
    await state.applyPromotionCode("WELCOME");
  if (applied.type === "success" && applied.sessionId !== state.sessionId)
    return;
  await state.removePromotionCode();
  await state.confirm({ paymentMethod: "pm_original_selected" });
  return observed;
}
