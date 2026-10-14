import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import { useQuery, useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  AffiliatePayoutEditor,
  type AffiliatePayoutEditorProps,
  type AffiliatePayoutUpdate,
} from "@fantastic.dev/better-stripe/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function AffiliatePayoutControl(props: AffiliatePayoutEditorProps) {
  return (
    <AffiliatePayoutEditor {...props}>
      {(state) => (
        <form
          aria-label="Affiliate payout"
          className="min-w-64 space-y-1 whitespace-normal"
          onSubmit={(event) => {
            event.preventDefault();
            void state.save();
          }}
        >
          <div className="flex items-center gap-1">
            <Input
              aria-label="Affiliate payout"
              className="w-20"
              type="number"
              min="0"
              max={state.mode === "percentage" ? 100 : undefined}
              step="0.01"
              inputMode="decimal"
              value={state.value}
              disabled={state.isPending}
              placeholder="Default"
              onChange={(event) => state.setValue(event.target.value)}
            />
            <div
              className="flex rounded-md border"
              role="group"
              aria-label="Payout type"
            >
              <Button
                size="sm"
                type="button"
                variant={state.mode === "percentage" ? "secondary" : "ghost"}
                aria-label="Percentage"
                aria-pressed={state.mode === "percentage"}
                disabled={state.isPending}
                onClick={() => state.setMode("percentage")}
              >
                %
              </Button>
              <Button
                size="sm"
                type="button"
                variant={state.mode === "fixed" ? "secondary" : "ghost"}
                aria-label={`Fixed amount in ${(props.currency ?? "usd").toUpperCase()}`}
                aria-pressed={state.mode === "fixed"}
                disabled={state.isPending}
                onClick={() => state.setMode("fixed")}
              >
                {state.currencySymbol}
              </Button>
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={state.isPending}
            >
              {state.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Clear affiliate payout"
              title="Clear override and inherit default"
              disabled={state.isPending}
              onClick={() => void state.clear()}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <Select
            items={[
              { value: "inherit", label: "Inherited term" },
              { value: "forever", label: "Forever" },
              { value: "one_time", label: "One-time" },
            ]}
            value={state.term}
            disabled={state.isPending}
            onValueChange={(value) =>
              state.setTerm(value as "inherit" | "forever" | "one_time")
            }
          >
            <SelectTrigger aria-label="Commission term">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherited term</SelectItem>
              <SelectItem value="forever">Forever</SelectItem>
              <SelectItem value="one_time">One-time</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {state.effectiveLabel}
          </p>
          {state.error && (
            <p role="alert" className="text-xs text-destructive">
              {state.error}
            </p>
          )}
          {state.message && (
            <p role="status" className="text-xs text-muted-foreground">
              {state.message}
            </p>
          )}
        </form>
      )}
    </AffiliatePayoutEditor>
  );
}

export function ProductAffiliateSettings({
  sellerId,
  stripeProductId,
  stripePriceId,
  currency = "usd",
  onSave,
}: {
  sellerId: string;
  stripeProductId: string;
  stripePriceId?: string;
  currency?: string;
  onSave: (
    update: AffiliatePayoutUpdate & {
      stripeProductId: string;
      stripePriceId?: string;
    },
  ) => Promise<unknown>;
}) {
  const state = useQuery(
    api.sellerAffiliateRates.get,
    stripeProductId
      ? { sellerId: sellerId as Id<"users">, stripeProductId, stripePriceId }
      : "skip",
  );
  const scope = stripePriceId ?? stripeProductId;
  if (!stripeProductId)
    return (
      <EmptyState>
        Choose a product to configure its affiliate payout.
      </EmptyState>
    );
  if (!state) return <Skeleton className="h-12 w-64" />;
  return (
    <div data-testid={`affiliate-rate-${scope}`}>
      <AffiliatePayoutControl
        {...state}
        scopeKey={`${sellerId}:${scope}`}
        currency={currency}
        onSave={(values) =>
          onSave({ ...values, stripeProductId, stripePriceId })
        }
      />
    </div>
  );
}

export function GlobalAffiliateSettings({
  actorId,
  sellerId,
}: {
  actorId: string;
  sellerId?: string;
}) {
  const state = useQuery(api.affiliateDefaults.get, {
    sellerId: sellerId as Id<"users"> | undefined,
  });
  const convex = useConvex();
  if (!state) return <Skeleton className="h-12 w-64" />;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"
      data-testid={
        sellerId ? "store-affiliate-default" : "platform-affiliate-default"
      }
    >
      <div>
        <p className="text-sm font-medium">
          {sellerId ? "Store-wide affiliate payout" : "Global affiliate payout"}
        </p>
        <p className="text-xs text-muted-foreground">
          Optional. Unset payouts inherit, with 0% when no default is
          configured.
        </p>
      </div>
      <AffiliatePayoutControl
        {...state}
        scopeKey={`default:${sellerId ?? "platform"}`}
        onSave={(values) =>
          convex.mutation(api.affiliateDefaults.save, {
            ...values,
            actorId: actorId as Id<"users">,
            sellerId: sellerId as Id<"users"> | undefined,
          })
        }
      />
    </div>
  );
}
