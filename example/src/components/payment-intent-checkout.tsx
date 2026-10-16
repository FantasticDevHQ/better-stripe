import { CheckoutFrame } from "./checkout-frame";
import { useAction } from "convex/react";
import { Checkout } from "@fantastic.dev/better-stripe/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRole } from "@/providers/role-context";
import { CheckoutFormFields } from "./checkout-form-fields";
export function PaymentIntentCheckout({
  priceId,
  referralCode,
  publishableKey,
}: {
  priceId: string;
  referralCode?: string;
  publishableKey: string;
}) {
  const { currentUser } = useRole();
  const create = useAction(api.checkoutExamples.actions.createPaymentIntent);
  return (
    <Checkout
      mode="payment-intent"
      orderKey={`${priceId}:${currentUser.id}:${referralCode ?? ""}`}
      publishableKey={publishableKey}
      email={currentUser.email}
      returnUrl={`${window.location.origin}/checkout/status`}
      renderForm={(state) => <CheckoutFormFields {...state} />}
      createPaymentIntent={({ requestId }) =>
        create({
          stripePriceId: priceId,
          userId: currentUser.id ? (currentUser.id as Id<"users">) : undefined,
          referralCode,
          requestId,
        })
      }
    >
      {(state) => <CheckoutFrame {...state} />}
    </Checkout>
  );
}
