import type { CheckoutRenderProps } from "@fantastic.dev/better-stripe/react";
import {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertAction,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
export function CheckoutFrame({
  content,
  isLoading,
  error,
  retry,
  continueToCheckout,
}: CheckoutRenderProps) {
  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Checkout Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <AlertAction>
          <Button variant="outline" onClick={retry}>
            Retry
          </Button>
        </AlertAction>
      </Alert>
    );
  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  if (continueToCheckout)
    return (
      <Button onClick={continueToCheckout}>Continue to Stripe Checkout</Button>
    );
  return <>{content}</>;
}
