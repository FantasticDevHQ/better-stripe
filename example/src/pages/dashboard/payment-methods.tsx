import { useCallback, useEffect, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/providers/role-context';
import {
  AddCardForm,
  PaymentMethodsList,
  StripeProviderWithKey,
  usePaymentMethodActions,
} from '@kellykampen/better-stripe/react';
import { useAction, useQuery } from 'convex/react';
import { CreditCard } from 'lucide-react';

import { api } from '../../../convex/_generated/api';

function PaymentMethodsInner({ stripeAccountId }: { stripeAccountId: string }) {
  const listMethods = useAction(api.actions.listPaymentMethods);
  const attachMethod = useAction(api.actions.attachPaymentMethod);
  const detachMethod = useAction(api.actions.detachPaymentMethod);
  const [methods, setMethods] = useState<Array<Record<string, unknown>>>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listMethods({ stripeCustomerId: stripeAccountId });
      setMethods(result ?? []);
    } catch (err) {
      console.error('Failed to load payment methods:', err);
    } finally {
      setIsLoading(false);
    }
  }, [listMethods, stripeAccountId]);

  useEffect(() => {
    void reload();
    // Only reload on mount or when stripeAccountId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripeAccountId]);

  const { createAndAttach } = usePaymentMethodActions({
    attach: async (paymentMethodId: string) => {
      await attachMethod({
        paymentMethodId,
        stripeCustomerId: stripeAccountId,
      });
      await reload();
    },
    detach: async (paymentMethodId: string) => {
      await detachMethod({ paymentMethodId });
      await reload();
    },
    reload,
  });

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
        <CardContent>
          <AddCardForm onSubmit={createAndAttach} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Payment Methods</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : methods.length === 0 ? (
            <Alert>
              <AlertDescription>
                No payment methods on file. Add one above.
              </AlertDescription>
            </Alert>
          ) : (
            <PaymentMethodsList
              methods={methods}
              onDetach={async (paymentMethodId: string) => {
                await detachMethod({ paymentMethodId });
                await reload();
              }}
            />
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
            No Stripe account is linked to your profile. Complete a checkout to
            create one, or visit the{' '}
            <a href="/creator/onboarding" className="text-primary underline">
              onboarding page
            </a>
            .
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
