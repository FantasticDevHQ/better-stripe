import { useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useWorkflowAction } from "@fantastic.dev/better-stripe/react";
import type {
  UsageAvailability,
  UsageInvoiceObservation,
  UsageSubscriptionView,
} from "@fantastic.dev/better-stripe/usage";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { ProductProvider } from "../../convex/meteredProducts/native";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SavedOffer } from "./metered-product-terms";
import { money } from "@/lib/metered-money";
import { EmptyState } from "@/components/empty-state";
import { ProductUsageViews } from "./metered-product-usage";
export function MeteredEnrollment({
  actorId,
  offer,
}: {
  actorId: Id<"users">;
  offer: Doc<"meteredProductOffers">;
}) {
  const enrollment = useQuery(api.meteredProducts.enrollments.current, {
    actorId,
    offerId: offer._id,
  });
  const checkout = useAction(api.meteredProducts.native.checkout);
  const refresh = useAction(api.meteredProducts.native.refresh);
  const preview = useAction(api.meteredProducts.readers.preview);
  const cancelRenewal = useAction(api.meteredProducts.native.cancelRenewal);
  const prepaidEnrollment =
    JSON.parse(offer.configurationJson).plan.model === "prepaid";
  const [revision, setRevision] = useState(0);
  const task = useWorkflowAction(
    async (operation: "checkout" | "refresh" | "preview" | "cancel") => {
      try {
        if (operation === "checkout") {
          const result = JSON.parse(
            await checkout({ actorId, offerId: offer._id }),
          ) as { status: string };
          return result.status === "open"
            ? "Checkout is ready. Open Stripe Checkout to pay, then refresh here."
            : prepaidEnrollment
              ? "Report service enrolled. Buy credits with the test card before generating reports."
              : "Original checkout observed. Refresh enrollment to check its active period.";
        }
        if (!enrollment) throw new Error();
        if (operation === "cancel") {
          const result = JSON.parse(
            await cancelRenewal({ actorId, enrollmentId: enrollment._id }),
          );
          if (result.status === "canceled")
            return "This original subscription has ended. Its history and credit liabilities are retained.";
          if (!result.cancelAtPeriodEnd)
            throw new Error("Cancellation is not confirmed.");
          return "Renewal canceled. Service continues until the original period ends. History and any unused credit liabilities are retained.";
        }
        if (operation === "preview") {
          const outcome = JSON.parse(
            await preview({ actorId, enrollmentId: enrollment._id }),
          ) as UsageAvailability<UsageInvoiceObservation>;
          if (
            outcome.status !== "available" ||
            !outcome.value.linesComplete ||
            outcome.value.meterAmount.status !== "available"
          )
            return "A complete original invoice preview is not available yet. Native aggregation can lag.";
          return `Draft next invoice: ${money(Number(outcome.value.total), outcome.value.currency)} total; usage portion ${money(Number(outcome.value.meterAmount.value.amount), outcome.value.currency)}. This is an estimate, not a payment or seller transfer.`;
        }

        await refresh({ actorId, enrollmentId: enrollment._id });
        return "Subscription refreshed. Each coaching session still checks the original payment before recording usage.";
      } catch {
        throw new Error(
          "Enrollment could not complete. Finish the original checkout and retry. Work remains unavailable until its subscription and payment are verified.",
        );
      }
    },
    `${actorId}:${offer._id}`,
    () => setRevision((value) => value + 1),
  );
  const hosted = enrollment?.checkoutJson
    ? (JSON.parse(enrollment.checkoutJson) as {
        status: string;
        url: string | null;
      })
    : null;
  const subscription = enrollment?.providerJson
    ? (JSON.parse(enrollment.providerJson) as UsageSubscriptionView)
    : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{offer.productName}</CardTitle>
        <CardDescription>
          Review your product terms before purchasing. Units apply to this
          product and its original billing period.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <SavedOffer offer={offer} />
          {enrollment === null && (
            <EmptyState>
              No subscription yet. Review these terms, then subscribe to begin.
            </EmptyState>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={task.isPending || subscription?.status === "active"}
              onClick={() => void task.run("checkout")}
            >
              {prepaidEnrollment
                ? subscription
                  ? "Report service enrolled"
                  : "Enroll in report service"
                : enrollment
                  ? "Resume original checkout"
                  : "Subscribe to this product"}
            </Button>
            {hosted?.status === "open" && hosted.url && (
              <Button
                render={
                  <a
                    aria-label="Open Stripe Checkout"
                    href={hosted.url}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                Open Stripe Checkout
              </Button>
            )}
            {enrollment && (
              <Button
                variant="outline"
                disabled={task.isPending}
                onClick={() => void task.run("refresh")}
              >
                Refresh enrollment
              </Button>
            )}
            {subscription && (
              <Button
                variant="outline"
                disabled={task.isPending}
                onClick={() => void task.run("preview")}
              >
                Preview next invoice
              </Button>
            )}
            {subscription && (
              <Button
                variant="outline"
                disabled={
                  task.isPending ||
                  subscription.cancelAtPeriodEnd ||
                  subscription.status !== "active"
                }
                onClick={() => void task.run("cancel")}
              >
                {subscription.cancelAtPeriodEnd
                  ? "Renewal canceled"
                  : "Cancel renewal"}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {prepaidEnrollment &&
            subscription &&
            subscription.collection.method !== "send_invoice" ? (
              "This earlier test enrollment uses unsupported automatic collection. Its original history is retained; new report enrollments use manual invoice collection."
            ) : prepaidEnrollment ? (
              "Enrollment uses manual invoice collection. Only prepaid work covered by verified credits is allowed. Buy report credits with the example test-card action."
            ) : (
              <>
                Use Stripe test card 4242 4242 4242 4242 at checkout. A return
                from checkout alone does not unlock usage.
              </>
            )}
          </p>
          {task.error && (
            <p role="alert" className="text-sm text-destructive">
              {task.error}
            </p>
          )}
          {task.result && (
            <p role="status" className="text-sm">
              {task.result}
            </p>
          )}
          {subscription && enrollment && (
            <>
              {(!prepaidEnrollment ||
                subscription.collection.method === "send_invoice") && (
                <PurchasedWork
                  actorId={actorId}
                  enrollment={enrollment}
                  offer={offer}
                  onChanged={() => setRevision((value) => value + 1)}
                />
              )}
              <ProductUsageViews
                actorId={actorId}
                enrollment={enrollment}
                subscription={subscription}
                revision={revision}
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
function PurchasedWork({
  actorId,
  enrollment,
  offer,
  onChanged,
}: {
  actorId: Id<"users">;
  enrollment: Doc<"meteredProductEnrollments">;
  offer: Doc<"meteredProductOffers">;
  onChanged: () => void;
}) {
  const consume = useAction(api.meteredProducts.work.consume);
  const purchase = useAction(api.meteredProducts.funding.purchase);
  const latestPurchase = useQuery(api.meteredProducts.funding.latest, {
    actorId,
    enrollmentId: enrollment._id,
  });
  const provider = JSON.parse(offer.providerJson!) as ProductProvider;
  const prepaid = provider.configuration.plan.model === "prepaid";
  const workKey = `metered-work:${actorId}:${enrollment._id}`;
  const [pendingWork, setPendingWork] = useState<{
    requestId: string;
    quantity: string;
  } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(workKey) ?? "null");
    } catch {
      return null;
    }
  });
  const [quantity, setQuantity] = useState(
    pendingWork?.quantity ?? (prepaid ? "1" : "15"),
  );
  const retry = pendingWork !== null;
  const purchaseId = useRef<string | null>(null);
  const [purchasePending, setPurchasePending] = useState(false);
  const task = useWorkflowAction(
    async (operation: "work" | "credits" | "retry-credit") => {
      const ref = { actorId, enrollmentId: enrollment._id };
      try {
        if (operation !== "work") {
          purchaseId.current ??=
            operation === "retry-credit" && latestPurchase
              ? latestPurchase
              : crypto.randomUUID();
          const value = JSON.parse(
            await purchase({ ...ref, requestId: purchaseId.current }),
          ) as { state: string };
          if (value.state === "ready") {
            setPurchasePending(false);
            purchaseId.current = null;
            return "Original credit payment verified. Your report credits are ready.";
          }
          return "The original credit purchase is pending. Retry it before making another purchase.";
        }
        const work = pendingWork ?? {
          requestId: crypto.randomUUID(),
          quantity,
        };
        setPendingWork(work);
        sessionStorage.setItem(workKey, JSON.stringify(work));
        const value = JSON.parse(
          await consume({
            ...ref,
            requestId: work.requestId,
            quantity: work.quantity,
          }),
        ) as { status: string; work: string };
        if (["accepted", "denied"].includes(value.status)) {
          sessionStorage.removeItem(workKey);
          setPendingWork(null);
        }
        return value.status === "accepted"
          ? value.work === "already_completed"
            ? "Original session replayed. No additional units recorded."
            : prepaid
              ? "Report generated. Credits consumed once."
              : "Coaching session completed. Minutes recorded once."
          : value.status === "denied"
            ? "Insufficient credits. No work performed."
            : "Work held until original credit backing is verified.";
      } catch {
        throw new Error(
          "The operation or its delivery is unconfirmed. Retry the original request to reconcile it; completed sessions keep their original units. New work requires verified payment and credit backing.",
        );
      }
    },
    `${actorId}:${enrollment._id}`,
    onChanged,
  );
  const pkg = provider.configuration.creditPackage;
  return (
    <div className="space-y-4 border-t pt-5">
      <h3 className="font-medium">
        {prepaid ? "Generate a store analytics report" : "One-on-one coaching"}
      </h3>
      {prepaid && pkg && (
        <div className="space-y-2">
          <p className="text-sm">
            {pkg.quantity} report credits ·{" "}
            {money(
              Number(
                BigInt(provider.configuration.plan.rate.unitAmountDecimal) *
                  BigInt(pkg.quantity),
              ),
              provider.price.currency,
            )}{" "}
            · manual top-up
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={task.isPending || purchasePending}
              onClick={() => {
                setPurchasePending(true);
                void task.run("credits");
              }}
            >
              Buy report credits with test card
            </Button>
            {latestPurchase && (
              <Button
                variant="outline"
                disabled={task.isPending}
                onClick={() => void task.run("retry-credit")}
              >
                Retry original credit purchase
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor={`units-${enrollment._id}`}>
            {prepaid ? "Reports to generate" : "Coaching minutes"}
          </Label>
          <Input
            id={`units-${enrollment._id}`}
            className="max-w-48"
            inputMode="decimal"
            value={quantity}
            disabled={retry || task.isPending}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        <Button disabled={task.isPending} onClick={() => void task.run("work")}>
          {retry
            ? "Retry original session"
            : prepaid
              ? "Generate reports"
              : "Complete coaching session"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {prepaid
          ? "Prepaid work consumes credits without another charge."
          : provider.configuration.plan.model === "included_overage"
            ? "Included minutes are used first. Any overage appears on the monthly Stripe invoice."
            : "Completed coaching minutes are billed on the monthly Stripe invoice."}
      </p>
      {task.error && (
        <p role="alert" className="text-sm text-destructive">
          {task.error}
        </p>
      )}
      {task.result && (
        <p role="status" className="text-sm">
          {task.result}
        </p>
      )}
    </div>
  );
}
