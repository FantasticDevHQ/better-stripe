import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/providers/role-context";
import {
  usePaymentMethodsManager,
  toPaymentMethodItem,
  AddCardForm,
  PaymentMethodsList,
  StripeProviderWithKey,
} from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { CreditCard } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "../../../convex/_generated/api";

function PaymentMethodsInner({ stripeAccountId }: { stripeAccountId: string }) {
  const listMethods = useAction(api.actions.listPaymentMethods);
  const attachMethod = useAction(api.actions.attachPaymentMethod);
  const detachMethod = useAction(api.actions.detachPaymentMethod);
  const {
    methods,
    isLoading,
    loadError,
    attachError,
    deleteError,
    attach,
    detach,
  } = usePaymentMethodsManager({
    scopeKey: stripeAccountId,
    load: async () =>
      ((await listMethods({ stripeCustomerId: stripeAccountId })) ?? []).map(
        (method) => toPaymentMethodItem(method),
      ),
    attach: (paymentMethodId) =>
      attachMethod({ paymentMethodId, stripeCustomerId: stripeAccountId }),
    detach: (paymentMethodId) => detachMethod({ paymentMethodId }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Add a Payment Method
            </div>
          </CardTitle>
          <CardDescription>Add a new card to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <AddCardForm
              onSuccess={(paymentMethodId) => {
                void attach(paymentMethodId);
              }}
            />

            {attachError && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>Action failed</AlertTitle>
                <AlertDescription>{attachError}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Payment Methods</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : loadError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>Failed to load payment methods</AlertTitle>
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            ) : methods.length === 0 ? (
              <Alert role="status" aria-live="polite">
                <AlertDescription>
                  No data found. Add a payment method above.
                </AlertDescription>
              </Alert>
            ) : (
              <PaymentMethodsList
                methods={methods}
                onDelete={(paymentMethodId) => {
                  void detach(paymentMethodId);
                }}
              />
            )}

            {deleteError && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>Action failed</AlertTitle>
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PaymentMethods() {
  const { currentUser } = useRole();
  const account = useQuery(api.queries.getAccountByUserId, {
    userId: currentUser.id,
  });

  if (account === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (account === null) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Payment Methods</h1>
          <p className="text-muted-foreground mt-1">
            Manage your saved payment methods.
          </p>
        </div>
        <Alert>
          <AlertDescription>
            No data yet. A checkout creates the Stripe account linked to your
            profile.{" "}
            <Link to="/" className="text-primary underline">
              Pick something to buy
            </Link>{" "}
            to get started.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Payment Methods</h1>
        <p className="text-muted-foreground mt-1">
          Manage your saved payment methods.
        </p>
      </div>

      <StripeProviderWithKey
        publishableKeyQuery={api.queries.getPublishableKey}
      >
        <PaymentMethodsInner stripeAccountId={account.stripeAccountId} />
      </StripeProviderWithKey>
    </div>
  );
}
