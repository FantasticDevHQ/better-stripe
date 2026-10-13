"use client";
import { useId, useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
import {
  Collection,
  type CollectionProps,
  type WorkflowColumn,
} from "./Collection.js";
import { SubscriptionCard } from "../components/SubscriptionCard.js";
export type SubscriptionRow = {
  stripeSubscriptionId: string;
  status: string;
  isTrialing?: boolean;
  cancelAtPeriodEnd?: boolean;
  isCollectionPaused?: boolean;
  currentPeriodEnd?: string | null;
  trialEnd?: string | null;
  quantity?: number;
  userId?: string;
};
export type SubscriptionActionType =
  | "pause"
  | "resume"
  | "reactivate"
  | "cancel"
  | "price"
  | "quantity"
  | "trial"
  | "endTrial";
export type SubscriptionCommand = {
  type: SubscriptionActionType;
  stripeSubscriptionId: string;
  stripePriceId?: string;
  quantity?: number;
  trialEnd?: string;
};
export type SubscriptionManagerOptions = {
  scopeKey: string;
  subscription: SubscriptionRow | null | undefined;
  onAction: (command: SubscriptionCommand) => Promise<unknown>;
};
const labels: Record<SubscriptionActionType, string> = {
  pause: "pause subscription",
  resume: "resume subscription",
  reactivate: "reactivate subscription",
  cancel: "cancel subscription",
  price: "change plan",
  quantity: "update quantity",
  trial: "update trial end",
  endTrial: "end trial now",
};
export function useSubscriptionManager(props: SubscriptionManagerOptions) {
  const scope = `${props.scopeKey}:${props.subscription?.stripeSubscriptionId ?? ""}`;
  const initial = { scope, quantity: "1", selectedPriceId: "", trialEnd: "" };
  const [fields, setFields] = useState(initial);
  if (fields.scope !== scope) setFields(initial);
  const [operation, setOperation] = useState<SubscriptionActionType>("pause");
  const action = useWorkflowAction(async (type: SubscriptionActionType) => {
    setOperation(type);
    if (!props.subscription) throw new Error("Select a subscription first.");
    const request: SubscriptionCommand = {
      type,
      stripeSubscriptionId: props.subscription.stripeSubscriptionId,
    };
    if (type === "quantity") {
      const quantity = Number(fields.quantity);
      if (
        !/^\d+$/.test(fields.quantity) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1
      )
        throw new Error("Enter a positive integer quantity.");
      request.quantity = quantity;
    }
    if (type === "price") {
      if (!fields.selectedPriceId) throw new Error("Choose a price first.");
      request.stripePriceId = fields.selectedPriceId;
    }
    if (type === "trial") {
      if (!fields.trialEnd || Number.isNaN(new Date(fields.trialEnd).getTime()))
        throw new Error("Enter a valid trial end date.");
      request.trialEnd = fields.trialEnd;
    }
    if (type === "endTrial") request.trialEnd = "now";
    await props.onAction(request);
    return `${labels[type]} requested. Waiting for Stripe webhook sync.`;
  }, scope);
  const active =
    props.subscription?.status === "active" ||
    props.subscription?.status === "trialing";
  return {
    ...fields,
    setQuantity: (quantity: string) =>
      setFields((previous) => ({ ...previous, quantity })),
    setSelectedPriceId: (selectedPriceId: string) =>
      setFields((previous) => ({ ...previous, selectedPriceId })),
    setTrialEnd: (trialEnd: string) =>
      setFields((previous) => ({ ...previous, trialEnd })),
    pendingAction: action.isPending ? labels[operation] : null,
    isPending: action.isPending,
    message: action.error ?? action.result ?? null,
    error: action.error,
    canPause: active && !props.subscription?.isCollectionPaused,
    canResume: !!props.subscription?.isCollectionPaused,
    canReactivate: active && !!props.subscription?.cancelAtPeriodEnd,
    run: action.run,
  };
}
export type SubscriptionManagerProps = SubscriptionManagerOptions & {
  children?: (state: ReturnType<typeof useSubscriptionManager>) => ReactNode;
};
export function SubscriptionManager(props: SubscriptionManagerProps) {
  const state = useSubscriptionManager(props);
  const id = useId();
  if (props.children) return <>{props.children(state)}</>;
  if (!props.subscription) return <p>No subscription selected.</p>;
  return (
    <section
      data-better-stripe="subscription-manager"
      aria-busy={state.isPending}
    >
      <SubscriptionCard
        subscription={{
          ...props.subscription,
          isTrialing: props.subscription.isTrialing ?? false,
          cancelAtPeriodEnd: props.subscription.cancelAtPeriodEnd ?? false,
        }}
      />
      {state.message && (
        <p role={state.error ? "alert" : "status"}>{state.message}</p>
      )}
      {(
        [
          ["pause", state.canPause],
          ["resume", state.canResume],
          ["reactivate", state.canReactivate],
          [
            "cancel",
            !props.subscription.cancelAtPeriodEnd &&
              props.subscription.status !== "canceled",
          ],
        ] as const
      ).map(([type, enabled]) => (
        <button
          type="button"
          key={type}
          disabled={!enabled || state.isPending}
          onClick={() => {
            void state.run(type);
          }}
        >
          {state.pendingAction === labels[type] ? "Processing…" : labels[type]}
        </button>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void state.run("price");
        }}
      >
        <label htmlFor={`${id}-price`}>Price ID</label>
        <input
          id={`${id}-price`}
          required
          value={state.selectedPriceId}
          onChange={(event) => state.setSelectedPriceId(event.target.value)}
        />
        <button type="submit" disabled={state.isPending}>
          Change plan
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void state.run("quantity");
        }}
      >
        <label htmlFor={`${id}-quantity`}>Quantity</label>
        <input
          id={`${id}-quantity`}
          type="number"
          min="1"
          step="1"
          required
          value={state.quantity}
          onChange={(event) => state.setQuantity(event.target.value)}
        />
        <button type="submit" disabled={state.isPending}>
          Update quantity
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void state.run("trial");
        }}
      >
        <label htmlFor={`${id}-trial`}>Trial end</label>
        <input
          id={`${id}-trial`}
          type="datetime-local"
          required
          value={state.trialEnd}
          onChange={(event) => state.setTrialEnd(event.target.value)}
        />
        <button type="submit" disabled={state.isPending}>
          Set trial end
        </button>
      </form>
      <button
        type="button"
        disabled={state.isPending}
        onClick={() => {
          void state.run("endTrial");
        }}
      >
        End trial now
      </button>
    </section>
  );
}
export const SUBSCRIPTION_FILTERS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Trialing", value: "trialing" },
  { label: "Past Due", value: "past_due" },
  { label: "Canceled", value: "canceled" },
] as const;
export function useSubscriptionFilter<T extends { status: string }>(
  subscriptions: T[] | undefined,
) {
  const [filter, setFilter] = useState("all");
  return {
    filter,
    setFilter,
    filtered:
      filter === "all"
        ? (subscriptions ?? [])
        : (subscriptions?.filter((row) => row.status === filter) ?? []),
    countByStatus: (status: string) =>
      subscriptions?.filter((row) => row.status === status).length ?? 0,
    tabs: SUBSCRIPTION_FILTERS,
  };
}
export type SubscriptionsProps<Row extends SubscriptionRow = SubscriptionRow> =
  Omit<CollectionProps<Row>, "getKey" | "columns"> & {
    columns?: WorkflowColumn<Row>[];
  };
export function Subscriptions<Row extends SubscriptionRow>(
  props: SubscriptionsProps<Row>,
) {
  const columns: WorkflowColumn<Row>[] = [
    {
      id: "id",
      label: "Subscription",
      cell: (row) => row.stripeSubscriptionId,
    },
    { id: "status", label: "Status", cell: (row) => row.status },
    {
      id: "period",
      label: "Current period end",
      cell: (row) =>
        row.currentPeriodEnd
          ? new Date(row.currentPeriodEnd).toLocaleDateString()
          : "Not supplied",
    },
    {
      id: "trial",
      label: "Trial end",
      cell: (row) =>
        row.trialEnd ? new Date(row.trialEnd).toLocaleDateString() : "None",
    },
  ];
  return (
    <Collection
      emptyLabel="No subscriptions yet."
      {...props}
      columns={props.columns ?? columns}
      getKey={(row) => row.stripeSubscriptionId}
    />
  );
}
