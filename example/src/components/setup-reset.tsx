import { useWorkflowAction } from "@fantastic.dev/better-stripe/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

export function ResetCard() {
  const resetAll = useAction(api.admin.actions.resetAll);
  const reset = useWorkflowAction(async () => {
    await resetAll({});
    return true;
  }, "reset");
  const isResetting = reset.isPending;
  const done = reset.result ?? false;
  const error = reset.error;
  const handleReset = () => reset.run();

  return (
    <Card size="panel">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">5. Reset</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Clear all data from the app database (every demo table) and the
              better-stripe component database (accounts, products, prices,
              subscriptions, invoices, payments, payouts, webhook events). Use
              this when you reset your Stripe sandbox. Restore custom payout
              policies to Stripe-managed defaults first. Active or unresolved
              payout state blocks reset and preserves local records. Reset
              refuses to run when the deployment uses a live Stripe key.
            </p>
          </div>
          <Dialog>
            <DialogTrigger
              render={
                <Button
                  variant="destructive-solid"
                  className="shrink-0"
                  disabled={isResetting}
                />
              }
            >
              {isResetting ? "Resetting…" : "Reset All Data"}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reset all data?</DialogTitle>
                <DialogDescription>
                  This permanently deletes every row in the app database and the
                  better-stripe component database for this deployment. It
                  cannot be undone. Stripe sandbox objects are not deleted.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <DialogClose
                  render={<Button variant="destructive-solid" />}
                  onClick={handleReset}
                >
                  Yes, reset everything
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {done && (
          <Alert>
            <AlertDescription>
              All data cleared. Click "Seed Data" above to re-populate.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </Card>
  );
}
