// Stateful synthetic Stripe HTTP layer for server-gated payment control tests.
// Only the endpoints these APIs use are modelled; anything else fails the test
// instead of reaching the network.
import Stripe from "stripe";
import { getStripeClient } from "../helpers.js";

type Intent = Record<string, unknown> & { id: string; status: string };
type Session = Record<string, unknown> & { id: string; status: string };

const CANCELABLE = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
]);

/** Confirmation tokens select the provider outcome of a server confirmation. */
const TOKEN_OUTCOMES: Record<string, string> = {
  ctoken_succeeds: "succeeded",
  ctoken_needs_action: "requires_action",
  ctoken_processing: "processing",
  ctoken_declined: "declined",
};

export type ProviderCall = {
  method: string;
  path: string;
  idempotencyKey: string | null;
  version: string | null;
  params: URLSearchParams;
};

export function createStripeTestLayer(key: string) {
  const intents = new Map<string, Intent>();
  const sessions = new Map<string, Session>();
  const replays = new Map<string, { status: number; body: unknown }>();
  const calls: ProviderCall[] = [];
  /** Run before the next cancel/expire is applied, to model a racing confirmation. */
  let beforeWrite: (() => void) | undefined;
  let sequence = 0;

  const error = (status: number, body: Record<string, unknown>) => ({
    status,
    body: { error: body },
  });
  const unexpected = (object: Intent | Session, kind: string) =>
    error(400, {
      type: "invalid_request_error",
      code:
        kind === "payment_intent"
          ? "payment_intent_unexpected_state"
          : "checkout_session_unexpected_state",
      message: `This ${kind} is ${object.status}.`,
      ...(kind === "payment_intent" ? { payment_intent: object } : {}),
    });

  function createIntent(params: URLSearchParams) {
    const token = params.get("confirmation_token") ?? "";
    const outcome = TOKEN_OUTCOMES[token];
    if (params.get("confirm") !== "true" || !outcome)
      return error(400, {
        type: "invalid_request_error",
        message: "Unknown confirmation token.",
      });
    const metadata: Record<string, string> = {};
    for (const [name, value] of params)
      if (name.startsWith("metadata["))
        metadata[name.slice("metadata[".length, -1)] = value;
    const id = `pi_test_${++sequence}`;
    const status = outcome === "declined" ? "requires_payment_method" : outcome;
    const intent: Intent = {
      id,
      object: "payment_intent",
      status,
      amount: Number(params.get("amount")),
      amount_received:
        status === "succeeded" ? Number(params.get("amount")) : 0,
      currency: params.get("currency"),
      customer_account: params.get("customer_account"),
      client_secret: `${id}_secret_test`,
      created: 1_800_000_000,
      canceled_at: null,
      cancellation_reason: null,
      latest_charge: status === "succeeded" ? `ch_test_${sequence}` : null,
      last_payment_error:
        outcome === "declined"
          ? {
              type: "card_error",
              code: "card_declined",
              decline_code: "generic_decline",
              message: "Your card was declined.",
            }
          : null,
      livemode: false,
      metadata,
    };
    intents.set(id, intent);
    if (outcome === "declined")
      return error(402, {
        type: "card_error",
        code: "card_declined",
        decline_code: "generic_decline",
        message: "Your card was declined.",
        payment_intent: intent,
      });
    return { status: 200, body: intent };
  }

  function cancelIntent(intent: Intent, params: URLSearchParams) {
    beforeWrite?.();
    beforeWrite = undefined;
    if (!CANCELABLE.has(intent.status))
      return unexpected(intent, "payment_intent");
    Object.assign(intent, {
      status: "canceled",
      canceled_at: 1_800_000_100,
      cancellation_reason: params.get("cancellation_reason"),
    });
    return { status: 200, body: intent };
  }

  function expireSession(session: Session) {
    beforeWrite?.();
    beforeWrite = undefined;
    if (session.status !== "open") return unexpected(session, "session");
    Object.assign(session, {
      status: "expired",
      client_secret: null,
      url: null,
    });
    return { status: 200, body: session };
  }

  function route(method: string, path: string, params: URLSearchParams) {
    let match: RegExpMatchArray | null;
    if (method === "POST" && path === "/v1/payment_intents")
      return createIntent(params);
    if ((match = path.match(/^\/v1\/payment_intents\/([^/]+)(\/cancel)?$/))) {
      const intent = intents.get(match[1]);
      if (!intent)
        return error(404, {
          type: "invalid_request_error",
          code: "resource_missing",
          message: "No such payment_intent.",
        });
      if (method === "GET" && !match[2]) return { status: 200, body: intent };
      if (method === "POST" && match[2]) return cancelIntent(intent, params);
    }
    if (
      (match = path.match(/^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/))
    ) {
      const session = sessions.get(match[1]);
      if (!session)
        return error(404, {
          type: "invalid_request_error",
          code: "resource_missing",
          message: "No such checkout.session.",
        });
      if (method === "GET" && !match[2]) return { status: 200, body: session };
      if (method === "POST" && match[2]) return expireSession(session);
    }
    if (method === "GET" && path === "/v1/prices/price_fixed")
      return {
        status: 200,
        body: {
          id: "price_fixed",
          object: "price",
          active: true,
          type: "one_time",
          unit_amount: 900,
          currency: "usd",
          product: { id: "prod_fixed", object: "product", active: true },
        },
      };
    throw new Error(`Unexpected Stripe request ${method} ${path}`);
  }

  const fetchFn: typeof fetch = async (url, init) => {
    const { pathname, searchParams } = new URL(String(url));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const params =
      method === "GET"
        ? searchParams
        : new URLSearchParams(String(init?.body ?? ""));
    const idempotencyKey = headers.get("Idempotency-Key");
    calls.push({
      method,
      path: pathname,
      idempotencyKey,
      version: headers.get("Stripe-Version"),
      params,
    });
    const replayKey = idempotencyKey && `${pathname}:${idempotencyKey}`;
    const result =
      (replayKey && replays.get(replayKey)) || route(method, pathname, params);
    if (replayKey)
      replays.set(replayKey, {
        status: result.status,
        body: JSON.parse(JSON.stringify(result.body)),
      });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json", "Request-Id": "req_test" },
    });
  };

  const sdk = getStripeClient(key) as unknown as {
    _setApiField: (name: string, value: unknown) => void;
  };
  sdk._setApiField("httpClient", Stripe.createFetchHttpClient(fetchFn));
  sdk._setApiField("maxNetworkRetries", 0);

  return {
    calls,
    intents,
    sessions,
    /** Seed an open Checkout Session that the provider knows about. */
    openSession(id: string) {
      const session: Session = {
        id,
        object: "checkout.session",
        status: "open",
        payment_status: "unpaid",
        mode: "payment",
        client_secret: `${id}_secret_test`,
        url: null,
      };
      sessions.set(id, session);
      return session;
    },
    /** Seed a PaymentIntent created outside the component (no ownership metadata). */
    foreignIntent(id: string) {
      intents.set(id, {
        id,
        object: "payment_intent",
        status: "requires_payment_method",
        amount: 900,
        amount_received: 0,
        currency: "usd",
        customer_account: null,
        metadata: {},
      });
    },
    raceNextWrite(change: () => void) {
      beforeWrite = change;
    },
    writes: () => calls.filter((call) => call.method === "POST"),
  };
}
