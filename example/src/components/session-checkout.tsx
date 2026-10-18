import { CheckoutFrame } from "./checkout-frame";
import { useAction } from "convex/react";
import { Checkout } from "@fantastic.dev/better-stripe/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRole } from "@/providers/role-context";
import { buildCheckoutReturnUrl } from "@/lib/checkout-return-url";
import { CheckoutFormFields } from "./checkout-form-fields";
import { CheckoutPromotionFields } from "./checkout-promotion-fields";
export function SessionCheckout({
  priceId,
  userId,
  publishableKey,
  referralCode,
  mode = "embedded",
}: {
  priceId: string;
  mode?: "custom" | "embedded" | "redirect" | "form";
  userId?: Id<"users">;
  referralCode?: string;
  publishableKey: string;
}) {
  const create = useAction(api.billing.public.actions.createCheckoutSession);
  const { currentUser } = useRole();
  return (
    <Checkout
      mode={mode}
      orderKey={`${priceId}:${userId ?? "guest"}:${referralCode ?? ""}`}
      publishableKey={publishableKey}
      email={currentUser.email}
      returnUrl={buildCheckoutReturnUrl(window.location.origin)}
      renderForm={(state) =>
        mode === "custom" ? (
          <CheckoutPromotionFields {...state} />
        ) : (
          <CheckoutFormFields {...state} />
        )
      }
      createSession={({ mode, requestId }) =>
        create({
          userId,
          uiMode: mode,
          requestId,
          referralCode,
          stripePriceId: priceId,
          returnUrl:
            mode === "redirect"
              ? `${window.location.origin}/checkout/status`
              : buildCheckoutReturnUrl(window.location.origin),
          cancelUrl: window.location.href,
        })
      }
    >
      {(state) => <CheckoutFrame {...state} />}
    </Checkout>
  );
}
