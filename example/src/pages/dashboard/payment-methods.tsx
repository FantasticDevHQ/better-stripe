import { useCallback, useEffect, useState } from "react";

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
  AddCardForm,
  type PaymentMethodItem,
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
  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await listMethods({ stripeCustomerId: stripeAccountId });
      setMethods(
        (result ?? []).map((pm) => ({
          id: pm.id,
          type: pm.type,
          card: pm.card
            ? {
                brand: pm.card.brand,
                last4: pm.card.last4,
                expMonth: pm.card.exp_month,
                expYear: pm.card.exp_year,
              }
            : undefined,
          isDefault: false,
        })),
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [listMethods, stripeAccountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount fetch
    void reload();
    // Only reload on mount or when stripeAccountId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripeAccountId]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Add a Payment Method
          </CardTitle>
          <CardDescription>Add a new card to your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AddCardForm
            onSuccess={async (paymentMethodId) => {
              setAttachError(null);
              try {
                await attachMethod({
                  paymentMethodId,
                  stripeCustomerId: stripeAccountId,
                });
                await reload();
              } catch (err) {
                setAttachError(
                  err instanceof Error ? err.message : String(err),
                );
              }
            }}
          />

          {attachError && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{attachError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Payment Methods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
              onDelete={async (paymentMethodId: string) => {
                setDeleteError(null);
                try {
                  await detachMethod({ paymentMethodId });
                  await reload();
                } catch (err) {
                  setDeleteError(
                    err instanceof Error ? err.message : String(err),
                  );
                }
              }}
            />
          )}

          {deleteError && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
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
