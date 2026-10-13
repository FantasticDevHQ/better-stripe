import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
export function PaymentIntentReceipt({
  paymentIntentId,
}: {
  paymentIntentId: string;
}) {
  const payment = useQuery(api.queries.getPaymentByStripeId, {
    stripePaymentIntentId: paymentIntentId,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {payment?.status === "succeeded"
            ? "Payment successful!"
            : "Payment status"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p role="status">
            {payment === undefined || payment === null
              ? "Waiting for Stripe payment confirmation…"
              : payment.status === "succeeded"
                ? "Your purchase is confirmed by Stripe."
                : `Stripe payment status: ${payment.status}`}
          </p>
          {payment === null && (
            <EmptyState>
              No payment recorded yet. Confirmation can take a moment after
              returning from Stripe.
            </EmptyState>
          )}
          {payment && (
            <p>
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: payment.currency,
              }).format(payment.amount / 100)}
            </p>
          )}
          <Link to="/stores" className="underline">
            Continue shopping
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
