import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PaymentReceipt,
  useWorkflowAction,
} from "@fantastic.dev/better-stripe/react";
import { useAction, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { CapturedReceiptContext } from "../../convex/billing/capturedReceipt/queries";

function ScopedReceipt({ context }: { context: CapturedReceiptContext }) {
  const read = useAction(api.billing.capturedReceipt.actions.read);
  const scope = JSON.stringify([
    context.actorId,
    context.accountId,
    context.sessionId,
  ]);
  const workflow = useWorkflowAction(read, scope);
  const result = workflow.result;
  const ready =
    result?.status === "ready" &&
    result.stripeSessionId === context.sessionId &&
    result.customerAccountId === context.accountId;
  const unavailable =
    Boolean(workflow.error) || (result !== undefined && !ready);

  return (
    <Card>
      <CardContent padding="status">
        <div className="space-y-4">
          {unavailable ? (
            <Alert>
              <AlertTitle>Payment receipt unavailable</AlertTitle>
              <AlertDescription>
                We could not confirm a captured payment for this checkout. You
                can try again safely.
              </AlertDescription>
            </Alert>
          ) : (
            <PaymentReceipt
              payment={
                ready
                  ? {
                      status: "succeeded",
                      amount: result.amount,
                      currency: result.currency,
                    }
                  : undefined
              }
            />
          )}
          <Button
            disabled={workflow.isPending}
            aria-busy={workflow.isPending}
            onClick={() => {
              void workflow.run({ stripeSessionId: context.sessionId });
            }}
          >
            {unavailable ? "Retry receipt" : "Read payment receipt"}
          </Button>
          <p className="text-muted-foreground text-sm">
            Payment confirmation and access are handled separately.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function CapturedCheckoutReceipt({
  stripeSessionId,
}: {
  stripeSessionId: string;
}) {
  const context = useQuery(api.billing.capturedReceipt.queries.context, {
    stripeSessionId,
  });
  if (context === undefined) {
    return <p role="status">Loading payment receipt…</p>;
  }
  if (!context || context.sessionId !== stripeSessionId) {
    return (
      <Alert>
        <AlertTitle>Payment receipt unavailable</AlertTitle>
        <AlertDescription>
          <EmptyState>No authorized checkout context is available.</EmptyState>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <ScopedReceipt
      key={JSON.stringify([
        context.actorId,
        context.accountId,
        context.sessionId,
      ])}
      context={context}
    />
  );
}
