import { useId, useState } from "react";
import {
  formatChargeAmount,
  useCheckoutSession,
  useWorkflowAction,
  type CheckoutFormState,
} from "@fantastic.dev/better-stripe/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CheckoutFormFields } from "./checkout-form-fields";

/** Custom-session presentation. The host enables eligible promotions on its original server request. */
export function CheckoutPromotionFields(state: CheckoutFormState) {
  const checkout = useCheckoutSession();
  return checkout.type === "success" ? (
    <ReadyPromotionFields
      key={checkout.sessionId}
      {...state}
      checkout={checkout}
    />
  ) : (
    <p role="status">Loading checkout…</p>
  );
}
function ReadyPromotionFields({
  checkout,
  ...state
}: CheckoutFormState & {
  checkout: Extract<ReturnType<typeof useCheckoutSession>, { type: "success" }>;
}) {
  const [code, setCode] = useState("");
  const id = useId();
  const promotion = useWorkflowAction(
    async (code: string | null) => {
      const result =
        code === null
          ? await checkout.removePromotionCode()
          : await checkout.applyPromotionCode(code);
      if (result.type === "error") throw new Error(result.message);
      return result;
    },
    checkout.sessionId,
    () => setCode(""),
  );
  const pending = state.isPending || promotion.isPending;
  return (
    <CheckoutFormFields
      {...state}
      isPending={pending}
      submit={(event) => {
        if (promotion.isPending) event.preventDefault();
        else state.submit(event);
      }}
      beforePayment={
        <div className="space-y-2">
          <Label htmlFor={id}>Promotion code</Label>
          <Input
            id={id}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={pending}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending || !code.trim()}
              onClick={() => void promotion.run(code)}
            >
              Apply code
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending || !checkout.pricing?.discount}
              onClick={() => void promotion.run(null)}
            >
              Remove code
            </Button>
          </div>
          {checkout.pricing ? (
            <p aria-live="polite">
              Current total:{" "}
              {formatChargeAmount(
                checkout.pricing.total,
                checkout.pricing.currency,
              )}
            </p>
          ) : (
            <p role="status">Current total unavailable</p>
          )}
          {promotion.error && <p role="alert">{promotion.error}</p>}
        </div>
      }
    />
  );
}
