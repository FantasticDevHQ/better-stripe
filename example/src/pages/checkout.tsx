import { useCallback, useRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/providers/role-context';
import { EmbeddedCheckout } from '@kkampen/better-stripe/react';
import { useAction, useQuery } from 'convex/react';
import { ArrowLeft } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../../convex/_generated/api';

function CheckoutForm({
  priceId,
  userId,
  publishableKey,
}: {
  priceId: string;
  userId: string;
  publishableKey: string;
}) {
  const createCheckout = useAction(api.actions.createCheckoutSession);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hasInitiated = useRef(false);

  const initCheckout = useCallback(async () => {
    if (hasInitiated.current) return;
    hasInitiated.current = true;
    setIsLoading(true);
    try {
      const session = await createCheckout({
        userId,
        stripePriceId: priceId,
        returnUrl:
          window.location.origin +
          '/checkout/status?session_id={CHECKOUT_SESSION_ID}',
      });
      if (session?.clientSecret) {
        setClientSecret(session.clientSecret);
      } else {
        setError(
          'Failed to create checkout session. No client secret returned.',
        );
      }
    } catch (err) {
      console.error('Checkout session error:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to create checkout session.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [createCheckout, userId, priceId]);

  // Trigger checkout on first render via a lazy initializer pattern
  if (!clientSecret && !error && !isLoading && !hasInitiated.current) {
    void initCheckout();
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Checkout Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!clientSecret) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <EmbeddedCheckout
      publishableKey={publishableKey}
      clientSecret={clientSecret}
      onComplete={() => {
        window.location.href = '/checkout/status?session_id=complete';
      }}
    />
  );
}

export function Checkout() {
  const [searchParams] = useSearchParams();
  const priceId = searchParams.get('priceId');
  const { currentUser } = useRole();
  const publishableKey = useQuery(api.queries.getPublishableKey);

  if (!priceId) {
    return (
      <div className="space-y-4 py-16 text-center">
        <Alert>
          <AlertTitle>No price selected</AlertTitle>
          <AlertDescription>
            Please select a price from the pricing page to continue.
          </AlertDescription>
        </Alert>
        <Button variant="link" asChild>
          <Link to="/">Back to pricing</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Checkout</h1>
        <p className="text-muted-foreground">
          Completing purchase for price:{' '}
          <code className="bg-muted rounded px-2 py-0.5 text-sm">
            {priceId}
          </code>
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          {!publishableKey ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <CheckoutForm
              priceId={priceId}
              userId={currentUser.id}
              publishableKey={publishableKey}
            />
          )}
        </CardContent>
      </Card>

      <Button variant="ghost" size="sm" asChild>
        <Link to="/">
          <ArrowLeft className="mr-1 h-3 w-3" />
          Back to pricing
        </Link>
      </Button>
    </div>
  );
}
