import { configuredHistoryResponse } from "./observationConfiguredHistoryNative.js";
import {
  declarePreflightCase,
  deepFreeze,
} from "./configurePreflightControls.js";

/** Every counterexample exists before any actual public constructor is called. */
export const writeCases = {
  dispatch: [
    "ack",
    "defaults-null",
    "defaults-object",
    "request-id-absent",
    "identity-only-ack",
  ],
  ownership: [
    "empty",
    "capture-arity",
    "invoke-arity",
    "consumed",
    "foreign-owner",
    "foreign-origin",
    "foreign-entry",
    "foreign-class",
    "foreign-operation",
    "foreign-plan",
    "foreign-delegate",
    "cloned-ack",
    "forged-preflight",
    "original-failure",
    "structural-failure",
  ],
  order: [
    "dispatch-send",
    "dispatch-ack",
    "wrong-ack",
    "duplicate-ack",
    "response-send",
    "response-ack",
    "wrong-c9",
    "receipt-send",
    "receipt-ack",
  ],
  transport: [
    "source-post-sync-throw",
    "source-post-nonpromise",
    "source-post-hostile-late-reject",
    "get-reject",
    "post-reject",
    "conflict",
    "diagnostics-empty",
    "error-envelope-missing-optionals",
    "diagnostics-unsafe",
    "redirect307",
    "redirect308",
    "unsafe-body",
    "unsafe-metadata",
    "retire-get",
    "retire-post",
    "retire-response",
    "retire-c9",
    "retire-receipt",
    "retire-final",
    "foreign-catch",
    "catch-once",
  ],
  replay: [
    "unknown-replay",
    "unknown-replay-repeat",
    "ack-closes-ancestor",
    "acknowledged-prior",
    "pending-prior",
    "not-posted-prior",
    "foreign-prior",
    "cloned-prior",
    "already-applied",
    "baseline-drift",
    "expired-owner",
  ],
  limits: [
    "whole-ack",
    "whole-failure",
    "token-forged",
    "escaped-token",
    "raw-digest",
    "special-keys",
    "repeated-reference",
    "numeric-array",
    "proxy",
    "accessor",
    "symbol",
    "nonenumerable",
    "cycle",
    "pan",
    "credential",
    "utf8",
    "nodes",
    "depth",
    "retention86399",
    "retention86400",
    "retention-negative",
    "retention-unsafe",
  ],
} as const;
export type WriteCase =
  | (typeof writeCases)[keyof typeof writeCases][number]
  | "configured-history"
  | "configured-history-onephase"
  | "configured-history-drift";

export function declareConfigureWriteCase(name: WriteCase) {
  const baseline = declarePreflightCase("positive");
  const replay = {
    initialMode:
      name === "acknowledged-prior"
        ? "ack"
        : name === "pending-prior"
          ? "pending-prior"
          : "post-reject",
    BMode:
      name === "unknown-replay-repeat"
        ? "post-reject"
        : name === "already-applied"
          ? "already-applied"
          : name === "baseline-drift"
            ? "baseline-drift"
            : "ack",
    CMode: "ack",
    previousC: name === "ack-closes-ancestor" ? "A" : "B",
    BAt: baseline.laterAt,
    CAt: baseline.laterAt + 1000,
  } as const;
  const response: Record<string, unknown> = structuredClone(baseline.schedule);
  // C9 is operation acknowledgement. This raw reply deliberately retains its one phase.
  delete response.default_settings;
  if (name === "defaults-null") response.default_settings = null;
  if (name === "defaults-object")
    response.default_settings = structuredClone(
      baseline.schedule.default_settings,
    );
  if (
    name === "configured-history" ||
    name === "configured-history-onephase" ||
    name === "configured-history-drift"
  )
    Object.assign(response, configuredHistoryResponse(baseline, name));
  const oracleResponse = structuredClone(response);
  if (name === "wrong-c9") response.id = "sub_sched_foreign";
  if (name === "unsafe-body") response.opaque = "sk_live_SYNTHETIC_UNSAFE";
  const currentBundle = structuredClone(baseline.baselineBundle);
  const currentSchedule = structuredClone(baseline.schedule);
  if (name === "baseline-drift")
    currentBundle.wireSubscription.metadata.keep = "drift";
  if (name === "already-applied")
    currentSchedule.phases.push(structuredClone(currentSchedule.phases[0]!));
  const status =
    name === "diagnostics-empty" ||
    name === "error-envelope-missing-optionals" ||
    name === "diagnostics-unsafe" ||
    name === "conflict"
      ? 409
      : name === "redirect307"
        ? 307
        : name === "redirect308"
          ? 308
          : 200;
  const errorBody =
    name === "diagnostics-empty"
      ? {}
      : name === "error-envelope-missing-optionals"
        ? { error: {} }
        : {
            error: {
              type: "idempotency_error",
              code: "idempotency_key_in_use",
              message: "Synthetic controlled conflict",
            },
          };
  const expected = baseline.original.attachRequest.preparation.expected;
  const currentItem = {
    tax_rates: "",
    price: expected.currentPriceId,
    quantity: 3,
    discounts: [{ discount: "di_item" }],
  };
  const targetItem = { ...currentItem, price: expected.targetPriceId };
  const expectedPayload = {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        default_tax_rates: "",
        start_date: expected.periodStart,
        end_date: expected.periodEnd,
        currency: "usd",
        proration_behavior: "create_prorations",
        items: [currentItem],
        discounts: [{ discount: "di_subscription" }],
      },
      {
        default_tax_rates: "",
        start_date: expected.periodEnd,
        currency: "usd",
        proration_behavior: "none",
        billing_cycle_anchor: "automatic",
        duration: { interval: "month", interval_count: 1 },
        items: [targetItem],
        discounts: [{ discount: "di_subscription" }],
      },
    ],
  };
  return deepFreeze({
    name,
    expectedPayload,
    replay,
    baseline,
    response,
    oracleResponse,
    currentBundle,
    currentSchedule,
    status,
    errorBody,
    requestId:
      name === "request-id-absent"
        ? null
        : name === "unsafe-metadata"
          ? "sk_live_SYNTHETIC_UNSAFE"
          : "req_SYNTHETIC_CONFIGURE_WRITE",
    oracleRequestId:
      name === "request-id-absent" ? null : "req_SYNTHETIC_CONFIGURE_WRITE",
    writeAt: baseline.scheduleAt,
    replayAt: baseline.laterAt,
    providerRejection: Object.freeze({
      type: "StripeConnectionError",
      code: "ECONNRESET",
    }),
    caps: { chars: 500000, bytes: 500000, nodes: 10000, depth: 40 },
    retention: {
      first: 100000,
      before: 186399,
      at: 186400,
      negative: 99999,
      unsafe: Number.MAX_SAFE_INTEGER + 1,
    },
  });
}

/** All mutations are finite TEST recipes; applying them never changes the retained oracle. */
export function limitCounterexample(ack: unknown, name: WriteCase) {
  const copy = structuredClone(ack) as Record<string, unknown>;
  const raw = copy.rawReceipt as Record<string, unknown>;
  const body = raw.providerSnapshot as Record<string, unknown>;
  if (name === "whole-ack") body.opaque = "x".repeat(500000);
  if (name === "utf8") body.opaque = "界".repeat(170000);
  if (name === "nodes") body.opaque = Array(10001).fill(null);
  if (name === "depth") {
    let node: Record<string, unknown> = {};
    body.opaque = node;
    for (let i = 0; i < 41; i++) {
      const next = {};
      node.next = next;
      node = next;
    }
  }
  if (name === "raw-digest" || name === "escaped-token")
    body[name === "escaped-token" ? "request/logicalBinding" : "opaque"] =
      "renewal:v2:sha256:" + "a".repeat(64);
  if (name === "token-forged")
    (copy.receipt as Record<string, unknown>).binding =
      "renewal-configure-receipt:v2:sha256:" + "b".repeat(64);
  if (name === "special-keys")
    Object.defineProperty(body, "__proto__", {
      value: { constructor: "retained", prototype: "retained" },
      enumerable: true,
    });
  if (name === "repeated-reference") {
    const shared = { retained: "twice" };
    body.left = shared;
    body.right = shared;
  }
  if (name === "numeric-array") body.opaque = ["zero", "one", "two"];
  if (name === "proxy")
    raw.providerSnapshot = new Proxy(body, {
      ownKeys() {
        throw Error("TEST_PROXY_REFLECTION");
      },
    });
  if (name === "accessor")
    Object.defineProperty(body, "opaque", {
      get() {
        throw Error("TEST_ACCESSOR_REFLECTION");
      },
      enumerable: true,
    });
  if (name === "symbol")
    Object.defineProperty(body, Symbol("opaque"), {
      value: "hidden",
      enumerable: true,
    });
  if (name === "nonenumerable")
    Object.defineProperty(body, "opaque", {
      value: "hidden",
      enumerable: false,
    });
  if (name === "cycle") body.opaque = body;
  if (name === "pan") body.opaque = "4242424242424242";
  if (name === "credential") body.opaque = "sk_live_SYNTHETIC_UNSAFE";
  return copy;
}

/** The entire finite Source family's raw scenarios exist before any constructor. */
export function declareConfigureWriteFamily(name: WriteCase) {
  const control = declareConfigureWriteCase(name);
  const replay = (writeCases.replay as readonly string[]).includes(name);
  return deepFreeze({
    control,
    stages: {
      A: replay
        ? declareConfigureWriteCase(control.replay.initialMode)
        : control,
      B: declareConfigureWriteCase(control.replay.BMode),
      C: declareConfigureWriteCase(control.replay.CMode),
    },
  });
}
