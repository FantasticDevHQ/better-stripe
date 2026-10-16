import { EmptyState } from "@/components/empty-state";
import { PaymentReceipt } from "@fantastic.dev/better-stripe/react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
export function PaymentIntentReceipt({
  paymentIntentId,
}: {
  paymentIntentId: string;
}) {
  const payment = useQuery(api.connect.queries.getPaymentByStripeId, {
    stripePaymentIntentId: paymentIntentId,
  });
  return (
    <PaymentReceipt payment={payment}>
      {(state) => (
        <Card>
          <CardHeader>
            <CardTitle>{state.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p role="status">{state.message}</p>
              {!payment && (
                <EmptyState>
                  No data yet. Confirmation will appear here after Stripe
                  reports the payment.
                </EmptyState>
              )}
              {state.amountLabel && <p>{state.amountLabel}</p>}
              <Link to="/stores" className="underline">
                Continue shopping
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </PaymentReceipt>
  );
}
