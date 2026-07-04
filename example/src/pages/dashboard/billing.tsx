import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/providers/role-context";
import {
  BillingPortalLink,
  BuyerBillingView,
  getSubscriptionStatusLabel,
} from "@getdojo/better-stripe/react";
import { useAction, useQuery } from "convex/react";
import { Clock, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "../../../convex/_generated/api";

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function formatDate(dateStr: string | undefined | null) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString();
}

function formatCurrency(amount: number, currency: string | undefined | null) {
  const normalized = currency?.toUpperCase() || "USD";
  const formatter =
    currencyFormatters.get(normalized) ??
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
    });
  currencyFormatters.set(normalized, formatter);
  return formatter.format(amount / 100);
}

function formatPriceLabel(price: {
  stripePriceId: string;
  unitAmount?: number | null;
  currency?: string;
  interval?: string | null;
  type?: string;
}) {
  const amount = formatCurrency(price.unitAmount ?? 0, price.currency);
  const interval =
    price.type === "recurring" ? ` / ${price.interval ?? "month"}` : "";
  return `${amount}${interval} (${price.stripePriceId})`;
}

function currentSubscriptionFrom<
  T extends {
    status: string;
    cancelAtPeriodEnd: boolean;
  },
>(subscriptions: T[]) {
  return (
    subscriptions.find((s) => s.cancelAtPeriodEnd) ??
    subscriptions.find((s) =>
      ["trialing", "active", "paused", "past_due", "unpaid"].includes(
        s.status,
      ),
    ) ??
    subscriptions[0] ??
    null
  );
}

export function Billing() {
  const { currentUser } = useRole();
  const subscriptions = useQuery(api.queries.listSubscriptionsByUser, {
    userId: currentUser.id,
  });
  const invoices = useQuery(api.queries.listInvoicesByUser, {
    userId: currentUser.id,
  });
  const account = useQuery(api.queries.getAccountByUserId, {
    userId: currentUser.id,
  });
  const prices = useQuery(api.queries.listPrices);

  const cancelSubscription = useAction(api.actions.cancelSubscription);
  const reactivateSubscription = useAction(api.actions.reactivateSubscription);
  const pauseSubscription = useAction(api.actions.pauseSubscription);
  const resumeSubscription = useAction(api.actions.resumeSubscription);
  const updateSubscriptionPrice = useAction(api.actions.updateSubscriptionPrice);
  const updateSubscriptionQuantity = useAction(
    api.actions.updateSubscriptionQuantity,
  );
  const updateSubscriptionTrialEnd = useAction(
    api.actions.updateSubscriptionTrialEnd,
  );
  const createBillingPortalSession = useAction(
    api.actions.createBillingPortalSession,
  );

  const subscription = useMemo(
    () => currentSubscriptionFrom(subscriptions ?? []),
    [subscriptions],
  );
  const activePrices = useMemo(
    () =>
      (prices ?? []).filter(
        (price) =>
          price.active &&
          price.type === "recurring" &&
          price.stripePriceId !== subscription?.priceId,
      ),
    [prices, subscription?.priceId],
  );

  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [selectedPriceId, setSelectedPriceId] = useState("");
  const [trialEnd, setTrialEnd] = useState("");

  const isLoading =
    subscriptions === undefined || account === undefined || prices === undefined;

  const runLifecycleAction = async (
    actionName: string,
    action: () => Promise<unknown>,
  ) => {
    setPendingAction(actionName);
    setMessage(null);
    try {
      await action();
      setMessage(`${actionName} requested. Waiting for Stripe webhook sync.`);
    } catch (err) {
      console.error(`Failed to ${actionName}:`, err);
      setMessage(
        err instanceof Error ? err.message : `Failed to ${actionName}.`,
      );
    } finally {
      setPendingAction(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-8" data-testid="buyer-subscription-shell">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (account === null) {
    return (
      <div className="space-y-8" data-testid="buyer-subscription-shell">
        <div>
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-muted-foreground mt-1">
            Manage your subscription and billing details.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <p className="text-muted-foreground">
              You don&apos;t have a billing account yet. Pick a plan to get
              started.
            </p>
            <Button render={<Link to="/" />}>Create account to subscribe</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isTrialing = subscription?.isTrialing ?? false;
  const canPause =
    subscription?.status === "active" || subscription?.status === "trialing";
  const canResume = subscription?.status === "paused";
  const canReactivate =
    !!subscription?.cancelAtPeriodEnd &&
    (subscription.status === "active" || subscription.status === "trialing");

  return (
    <div className="space-y-8" data-testid="buyer-subscription-shell">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your subscription lifecycle and billing details.
        </p>
      </div>

      {isTrialing && subscription?.trialEnd && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertTitle>Trial ends {formatDate(subscription.trialEnd)}</AlertTitle>
          <AlertDescription>
            End the trial immediately or choose a new date from the lifecycle
            controls below.
          </AlertDescription>
        </Alert>
      )}

      {message && (
        <Alert>
          <AlertDescription data-testid="buyer-subscription-action-message">
            {message}
          </AlertDescription>
        </Alert>
      )}

      {subscription ? (
        <Card>
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="break-all text-xl font-bold">
                  {subscription.stripeSubscriptionId}
                </p>
                <p className="text-muted-foreground break-all text-sm">
                  {subscription.priceId ?? "Unknown price"}
                </p>
              </div>
              <Badge
                data-testid="buyer-subscription-status"
                variant={
                  subscription.cancelAtPeriodEnd ? "destructive" : "default"
                }
              >
                {subscription.cancelAtPeriodEnd
                  ? "Cancels at period end"
                  : getSubscriptionStatusLabel(subscription.status)}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              Current period: {formatDate(subscription.currentPeriodStart)} -{" "}
              {formatDate(subscription.currentPeriodEnd)}
            </p>
            {typeof subscription.quantity === "number" && (
              <p className="text-muted-foreground text-sm">
                Quantity: {subscription.quantity}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No subscription yet.</p>
          </CardContent>
        </Card>
      )}

      {subscription && (
        <Card>
          <CardHeader>
            <CardTitle>Manage Subscription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <BuyerBillingView
              subscriptions={[
                {
                  id: subscription.stripeSubscriptionId,
                  status: subscription.status,
                  isTrialing: subscription.isTrialing,
                  trialEnd: subscription.trialEnd,
                  currentPeriodEnd: subscription.currentPeriodEnd,
                  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                  canceledAt: subscription.canceledAt,
                  destinationAccountId: subscription.accountId,
                },
              ]}
              paymentMethod={null}
              emptyLabel="No subscription yet"
              storeName={(storeAccountId) =>
                storeAccountId ? `Store ${storeAccountId}` : "Platform"
              }
            >
              {({ groups }) => (
                <div className="space-y-3">
                  {groups.map((group) => (
                    <div
                      key={group.storeAccountId ?? "platform"}
                      className="rounded-lg border p-3"
                    >
                      <p className="text-sm font-medium">
                        {group.storeAccountId
                          ? `Store ${group.storeAccountId}`
                          : "Platform subscription"}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Buyer subscription grouped with the library&apos;s
                        BuyerBillingView.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </BuyerBillingView>

            <div className="flex flex-wrap gap-3">
              <BillingPortalLink
                onCreateSession={async () => {
                  const { url } = await createBillingPortalSession({
                    stripeAccountId: account.stripeAccountId,
                    returnUrl: window.location.href,
                  });
                  window.location.assign(url);
                }}
              >
                {({ onClick, isLoading: portalLoading }) => (
                  <Button
                    variant="outline"
                    onClick={onClick}
                    disabled={portalLoading}
                    data-testid="buyer-subscription-portal"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {portalLoading ? "Opening portal..." : "Open Billing Portal"}
                  </Button>
                )}
              </BillingPortalLink>

              <Button
                variant="outline"
                disabled={!canPause || pendingAction !== null}
                data-testid="buyer-subscription-pause"
                onClick={() =>
                  runLifecycleAction("pause subscription", () =>
                    pauseSubscription({
                      userId: currentUser.id,
                      stripeSubscriptionId: subscription.stripeSubscriptionId,
                      behavior: "keep_as_draft",
                    }),
                  )
                }
              >
                Pause
              </Button>

              <Button
                variant="outline"
                disabled={!canResume || pendingAction !== null}
                data-testid="buyer-subscription-resume"
                onClick={() =>
                  runLifecycleAction("resume subscription", () =>
                    resumeSubscription({
                      userId: currentUser.id,
                      stripeSubscriptionId: subscription.stripeSubscriptionId,
                    }),
                  )
                }
              >
                Resume
              </Button>

              <Button
                variant="outline"
                disabled={!canReactivate || pendingAction !== null}
                data-testid="buyer-subscription-reactivate"
                onClick={() =>
                  runLifecycleAction("reactivate subscription", () =>
                    reactivateSubscription({
                      userId: currentUser.id,
                      stripeSubscriptionId: subscription.stripeSubscriptionId,
                    }),
                  )
                }
              >
                Reactivate
              </Button>

              {!subscription.cancelAtPeriodEnd && (
                <Button
                  variant="destructive"
                  disabled={pendingAction !== null}
                  data-testid="buyer-subscription-cancel"
                  onClick={() =>
                    runLifecycleAction("cancel subscription", () =>
                      cancelSubscription({
                        userId: currentUser.id,
                        stripeSubscriptionId: subscription.stripeSubscriptionId,
                      }),
                    )
                  }
                >
                  Cancel
                </Button>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="buyer-subscription-plan">Plan change</Label>
                <Select
                  value={selectedPriceId}
                  onValueChange={(value) => setSelectedPriceId(value ?? "")}
                >
                  <SelectTrigger
                    id="buyer-subscription-plan"
                    className="w-full"
                    data-testid="buyer-subscription-plan-select"
                  >
                    <SelectValue placeholder="Choose a recurring price" />
                  </SelectTrigger>
                  <SelectContent>
                    {activePrices.map((price) => (
                      <SelectItem
                        key={price.stripePriceId}
                        value={price.stripePriceId}
                      >
                        {formatPriceLabel(price)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={!selectedPriceId || pendingAction !== null}
                  data-testid="buyer-subscription-plan-change"
                  onClick={() =>
                    runLifecycleAction("change plan", () =>
                      updateSubscriptionPrice({
                        userId: currentUser.id,
                        stripeSubscriptionId: subscription.stripeSubscriptionId,
                        stripePriceId: selectedPriceId,
                        prorationBehavior: "none",
                      }),
                    )
                  }
                >
                  Change plan
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="buyer-subscription-quantity">Quantity</Label>
                <Input
                  id="buyer-subscription-quantity"
                  type="number"
                  min={1}
                  value={quantity}
                  data-testid="buyer-subscription-quantity-input"
                  onChange={(event) => setQuantity(event.target.value)}
                />
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={Number(quantity) < 1 || pendingAction !== null}
                  data-testid="buyer-subscription-quantity-change"
                  onClick={() =>
                    runLifecycleAction("update quantity", () =>
                      updateSubscriptionQuantity({
                        userId: currentUser.id,
                        stripeSubscriptionId: subscription.stripeSubscriptionId,
                        quantity: Number(quantity),
                      }),
                    )
                  }
                >
                  Update quantity
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="buyer-subscription-trial-end">Trial end</Label>
                <Input
                  id="buyer-subscription-trial-end"
                  type="date"
                  value={trialEnd}
                  data-testid="buyer-subscription-trial-end-input"
                  onChange={(event) => setTrialEnd(event.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    disabled={!trialEnd || pendingAction !== null}
                    data-testid="buyer-subscription-trial-end-update"
                    onClick={() =>
                      runLifecycleAction("update trial end", () =>
                        updateSubscriptionTrialEnd({
                          userId: currentUser.id,
                          stripeSubscriptionId:
                            subscription.stripeSubscriptionId,
                          trialEnd,
                        }),
                      )
                    }
                  >
                    Set date
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={pendingAction !== null}
                    data-testid="buyer-subscription-trial-end-now"
                    onClick={() =>
                      runLifecycleAction("end trial now", () =>
                        updateSubscriptionTrialEnd({
                          userId: currentUser.id,
                          stripeSubscriptionId:
                            subscription.stripeSubscriptionId,
                          trialEnd: "now",
                        }),
                      )
                    }
                  >
                    End now
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {invoices !== undefined && invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invoices.slice(0, 5).map((invoice) => (
                <div
                  key={invoice._id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-muted-foreground break-all">
                    {invoice.stripeInvoiceId}
                  </span>
                  <span className="font-medium">
                    {formatCurrency(invoice.amountPaid ?? 0, invoice.currency)}
                  </span>
                  <Badge variant="outline" className="capitalize">
                    {invoice.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
