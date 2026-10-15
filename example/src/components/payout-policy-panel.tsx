import { useState } from "react";
import { useAction } from "convex/react";
import { RefreshCw } from "lucide-react";
import {
  PayoutProgress,
  PayoutSettings,
  useWorkflowResource,
  type PayoutProgressState,
  type PayoutSettingsState,
} from "@fantastic.dev/better-stripe/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Progress } from "./ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
const formatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const date = (time: number) => formatter.format(time);
export function PayoutPolicyPanel({
  userId,
  currencies,
}: {
  userId: Id<"users">;
  currencies: string[];
}) {
  const [currency, setCurrency] = useState(currencies[0] ?? "usd");
  const load = useAction(api.recipientPayoutPolicy.load);
  const save = useAction(api.recipientPayoutPolicy.save);
  const retry = useAction(api.recipientPayoutPolicy.retry);
  const resource = useWorkflowResource(
    () => load({ userId, currency }),
    `${userId}:${currency}`,
  );
  const data = resource.error ? undefined : resource.data;
  const choices = [
    ...new Set([
      currency,
      ...currencies,
      ...(data?.policy?.thresholds.map((t) => t.currency) ?? []),
    ]),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatic payout policy</CardTitle>
        <CardDescription>
          One combined minimum for store and affiliate earnings in each
          settlement currency.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh payout policy"
            disabled={resource.isLoading}
            onClick={resource.refresh}
          >
            <RefreshCw aria-hidden="true" data-icon="inline-start" /> Refresh
            policy
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Demo persona access. Production apps must authenticate the recipient
            and resolve liabilities on the server.
          </p>
          {choices.length > 1 && (
            <Select
              value={currency}
              onValueChange={(value) => {
                if (value) setCurrency(value);
              }}
              items={choices.map((value) => ({
                value,
                label: value.toUpperCase(),
              }))}
            >
              <SelectTrigger aria-label="Settlement currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {resource.error && (
            <Alert variant="destructive">
              <AlertDescription>{resource.error}</AlertDescription>
            </Alert>
          )}
          <PayoutProgress
            policy={data?.policy}
            preview={data?.preview}
            currency={currency}
            nextAttemptAt={data?.nextAttemptAt}
          >
            {(state) => <ProgressView state={state} />}
          </PayoutProgress>
          <PayoutSettings
            scopeKey={`${userId}:${currency}`}
            currency={currency}
            policy={data?.policy}
            onSave={async (change) => {
              try {
                return await save({ userId, ...change });
              } finally {
                resource.refresh();
              }
            }}
            onRetry={async () => {
              try {
                return await retry({ userId });
              } finally {
                resource.refresh();
              }
            }}
          >
            {(state) => <SettingsView state={state} />}
          </PayoutSettings>
        </div>
      </CardContent>
    </Card>
  );
}
function ProgressView({ state }: { state: PayoutProgressState }) {
  return (
    <div className="space-y-4">
      <p role="status" className="text-sm">
        {state.message}
      </p>
      <p className="text-sm text-muted-foreground">
        Stripe enforces its payout floor. A numeric provider floor is not
        available.
      </p>
      {state.recovery?.balances && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Stripe balances at last expiry check. These are not a payable
            earnings assessment; currencies remain separate.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {state.recovery.balances.map((balance) => (
              <Card key={balance.currency} size="sm" variant="muted">
                <CardHeader>
                  <CardTitle variant="metric">
                    {balance.currency.toUpperCase()} provider balance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p>Available: {balance.availableLabel}</p>
                  <p>Pending: {balance.pendingLabel}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
      {state.progress && (
        <Progress
          aria-label="Combined payout minimum"
          value={state.progress.value}
          max={state.progress.max}
        />
      )}
      {state.metrics.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {state.metrics.map((metric) => (
            <Card key={metric.key} size="sm" variant="muted">
              <CardHeader>
                <CardTitle variant="metric">{metric.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {metric.formattedValue}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {state.sources.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            Source contributions are before shared costs and obligations.
            Pending settlement does not count toward the minimum.
          </p>
          {state.accounting && (
            <p className="text-sm text-muted-foreground">
              Carried-forward funds remain owed. In-flight payouts are separate
              from completed payouts. Paid-out amounts exclude returned payouts.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Mature unpaid</TableHead>
                <TableHead>Pending settlement</TableHead>
                {state.accounting && <TableHead>In flight</TableHead>}
                {state.accounting && <TableHead>Paid out</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.sources.map((source) => (
                <TableRow key={source.role}>
                  <TableCell>
                    {source.role === "store"
                      ? "Store"
                      : source.role === "affiliate"
                        ? "Affiliate"
                        : "Other"}
                  </TableCell>
                  <TableCell variant="amount">{source.matureLabel}</TableCell>
                  <TableCell variant="amount">{source.pendingLabel}</TableCell>
                  {state.accounting && (
                    <TableCell variant="amount">
                      {source.reservedLabel ?? "Not assessed"}
                    </TableCell>
                  )}
                  {state.accounting && (
                    <TableCell variant="amount">
                      {source.releasedLabel ?? "Not assessed"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {state.nextAttemptAt !== null && (
        <p className="text-sm">
          Next automatic attempt: {date(state.nextAttemptAt)} UTC. This is not a
          bank arrival date.
        </p>
      )}
      {state.holdDeadline !== null && (
        <p className="text-sm text-muted-foreground">
          Custom holding deadline: {date(state.holdDeadline)} UTC
        </p>
      )}
      {state.observedAt !== null && (
        <p className="text-sm text-muted-foreground">
          {state.recovery ? "Last recovery check" : "Assessed"}:{" "}
          {date(state.observedAt)} UTC. Provider state is verified again
          automatically.
        </p>
      )}
    </div>
  );
}
function SettingsView({ state }: { state: PayoutSettingsState }) {
  const locked = state.isLoading || state.isChanging || state.isPending;
  return (
    <form
      className="space-y-4 border-t pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        void state.save();
      }}
    >
      <h3 className="font-semibold">Payout settings</h3>
      <div className="space-y-2">
        <Label htmlFor={`${state.inputId}-mode`}>Automatic payout policy</Label>
        <Select
          value={state.mode}
          disabled={locked}
          onValueChange={(mode) => {
            if (mode) state.setMode(mode as PayoutSettingsState["mode"]);
          }}
          items={[
            {
              value: "stripe_managed",
              label: "Stripe-managed automatic payouts, all currencies",
            },
            { value: "custom", label: "Custom combined minimum" },
          ]}
        >
          <SelectTrigger
            id={`${state.inputId}-mode`}
            aria-label="Automatic payout policy"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stripe_managed">
              Stripe-managed automatic payouts, all currencies
            </SelectItem>
            <SelectItem value="custom">Custom combined minimum</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {state.mode === "custom" && (
        <div className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label htmlFor={`${state.inputId}-minimum`}>
              Minimum ({state.currency.toUpperCase()})
            </Label>
            <Input
              id={`${state.inputId}-minimum`}
              required
              pattern="[0-9]+([.][0-9]+)?"
              inputMode="decimal"
              disabled={locked}
              value={state.minimum}
              onChange={(event) => state.setMinimum(event.target.value)}
            />
          </div>
          <Label multiline className="items-start">
            <Input
              type="checkbox"
              required
              className="mt-1 size-4 shrink-0"
              disabled={locked}
              checked={state.consent}
              onChange={(event) => state.setConsent(event.target.checked)}
            />
            I agree to hold funds in my Stripe balance until the combined
            minimum is met, subject to the holding deadline. The application
            minimum is waived for final automatic attempts during the last day;
            Stripe payout limits and balance checks still apply.
          </Label>
          <p className="text-sm text-muted-foreground">
            Custom schedules apply to the entire account. Configure each
            settlement currency. Other minimums are preserved, and below-minimum
            funds remain owed.
          </p>
        </div>
      )}
      {state.isLoading && <p role="status">Loading payout settings…</p>}
      {state.isChanging && (
        <Alert>
          <AlertDescription>
            A settings change is being verified. The automatic worker will
            resume it.
          </AlertDescription>
        </Alert>
      )}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.message && (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!state.canSave}>
          {state.isPending ? "Saving…" : "Save payout settings"}
        </Button>
        {state.isChanging && (
          <Button
            type="button"
            variant="outline"
            disabled={state.isPending}
            onClick={() => void state.retry()}
          >
            Retry settings verification
          </Button>
        )}
      </div>
    </form>
  );
}
