import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";
import type Stripe from "stripe";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * V2 thin event as received from Stripe webhooks.
 *
 * The Stripe SDK's `EventBase` type represents the API response from
 * `stripe.v2.core.events.retrieve()`, which has a different shape than
 * the raw webhook notification payload. Webhook payloads include
 * `related_object` for object reference, while the SDK type uses `changes`.
 *
 * @see https://docs.stripe.com/event-destinations#benefits-of-thin-events
 */
export type V2ThinEvent = {
  id: string;
  type: string;
  created: string;
  livemode?: boolean;
  related_object?: {
    id: string;
    type: string;
    url: string;
  };
  context?: string;
};

/** A webhook event can be either a V1 Event or a V2 thin event */
export type StripeWebhookEvent = Stripe.Event | V2ThinEvent;

/** Handler function for processing webhook events */
export type StripeEventHandler<T = StripeWebhookEvent> = (
  ctx: WebhookActionCtx,
  event: T,
) => Promise<void>;

/** Map of event type strings to their handlers */
export type StripeEventHandlers = {
  [eventType: string]: StripeEventHandler<StripeWebhookEvent>;
};

/**
 * Convex action context for webhook handlers.
 * This is a Convex runtime type, not a Stripe type.
 */
export type WebhookActionCtx = {
  runQuery: <Query extends FunctionReference<"query", "public" | "internal">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  runMutation: <
    Mutation extends FunctionReference<"mutation", "public" | "internal">,
  >(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
  runAction: <
    Action extends FunctionReference<"action", "public" | "internal">,
  >(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ) => Promise<FunctionReturnType<Action>>;
};
