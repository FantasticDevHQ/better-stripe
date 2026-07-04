import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { STRIPE_API_VERSION } from "../constants.js";
import type { Component } from "../helpers.js";
import type { TriggerDispatcherName } from "../types/triggers.js";
import type { WebhookContext } from "./helpers.js";
import {
  componentRef,
  deriveTrialFields,
  DISPATCHER_UPSERT_PATHS,
  dispatchUpsert,
  epochToIso,
  extractIdentifiers,
  getComponentRef,
  getStripeClient,
  jsonResponse,
} from "./helpers.js";

const TO_REF = Symbol.for("toReferencePath");

/** Build a ref carrying the Convex `toReferencePath` symbol used for lookups. */
const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });

/**
 * Fake component carrying nested refs. By default it exposes the
 * `core.queries.getAccount` anchor plus a couple of specific paths, but callers
 * can omit the anchor or a path to exercise the synthetic/throw branches.
 */
function makeComponent(opts?: {
  withAnchor?: boolean;
  paths?: string[];
}): Component {
  const withAnchor = opts?.withAnchor ?? true;
  const comp: Record<string, unknown> = {};
  const set = (path: string) => {
    const [domain, kind, name] = path.split("/");
    const d = (comp[domain] ??= {}) as Record<string, unknown>;
    const k = (d[kind] ??= {}) as Record<string, unknown>;
    k[name] = ref(path);
  };
  if (withAnchor) set("core/queries/getAccount");
  for (const p of opts?.paths ?? []) set(p);
  return comp as unknown as Component;
}

describe("epochToIso", () => {
  it("converts unix epoch seconds to ISO string", () => {
    // 2024-01-01T00:00:00.000Z = 1704067200
    expect(epochToIso(1704067200)).toBe("2024-01-01T00:00:00.000Z");
  });

  it("returns undefined for null", () => {
    expect(epochToIso(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(epochToIso(undefined)).toBeUndefined();
  });

  it("handles epoch 0 (Unix epoch start)", () => {
    expect(epochToIso(0)).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("extractIdentifiers", () => {
  it("extracts userId and orgId from metadata", () => {
    const result = extractIdentifiers({
      userId: "user_123",
      orgId: "org_456",
    });
    expect(result.userId).toBe("user_123");
    expect(result.orgId).toBe("org_456");
  });

  it("falls back to snake_case keys", () => {
    const result = extractIdentifiers({
      user_id: "user_snake",
      org_id: "org_snake",
    });
    expect(result.userId).toBe("user_snake");
    expect(result.orgId).toBe("org_snake");
  });

  it("prefers camelCase over snake_case", () => {
    const result = extractIdentifiers({
      userId: "camel",
      user_id: "snake",
    });
    expect(result.userId).toBe("camel");
  });

  it("returns empty string userId for null metadata", () => {
    expect(extractIdentifiers(null).userId).toBe("");
    expect(extractIdentifiers(undefined).userId).toBe("");
  });

  it("returns undefined orgId when not present", () => {
    const result = extractIdentifiers({ userId: "user_123" });
    expect(result.orgId).toBeUndefined();
  });
});

describe("jsonResponse", () => {
  it("creates a Response with JSON body", async () => {
    const res = jsonResponse({ ok: true }, 200);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("uses the provided status code", async () => {
    const res = jsonResponse({ error: "not found" }, 404);
    expect(res.status).toBe(404);
  });
});

describe("deriveTrialFields", () => {
  const sub = (over: Partial<Stripe.Subscription>) =>
    over as unknown as Stripe.Subscription;

  it("marks isTrialing true only when status is exactly 'trialing'", () => {
    expect(
      deriveTrialFields(sub({ status: "trialing", trial_start: null, trial_end: null }))
        .isTrialing,
    ).toBe(true);
    expect(
      deriveTrialFields(sub({ status: "active", trial_start: null, trial_end: null }))
        .isTrialing,
    ).toBe(false);
    expect(
      deriveTrialFields(sub({ status: "past_due", trial_start: null, trial_end: null }))
        .isTrialing,
    ).toBe(false);
  });

  it("converts trial_start/trial_end epochs to ISO strings", () => {
    const result = deriveTrialFields(
      sub({ status: "trialing", trial_start: 1704067200, trial_end: 1704153600 }),
    );
    expect(result.trialStart).toBe("2024-01-01T00:00:00.000Z");
    expect(result.trialEnd).toBe("2024-01-02T00:00:00.000Z");
  });

  it("returns undefined trial bounds when the epochs are null", () => {
    const result = deriveTrialFields(
      sub({ status: "active", trial_start: null, trial_end: null }),
    );
    expect(result.trialStart).toBeUndefined();
    expect(result.trialEnd).toBeUndefined();
  });
});

describe("componentRef", () => {
  it("returns the ref via direct property lookup when the path exists", () => {
    const component = makeComponent({ paths: ["billing/queries/getSubscription"] });
    const result = componentRef(component, "billing/queries/getSubscription");
    expect((result as any)[TO_REF]).toBe(
      "betterStripe/billing/queries/getSubscription",
    );
  });

  it("synthesizes a ref from the anchor's base path when the path is absent", () => {
    // Only the anchor (core/queries/getAccount) exists; the requested path does not.
    const component = makeComponent();
    const result = componentRef(component, "billing/mutations/upsertInvoice");
    expect((result as any)[TO_REF]).toBe(
      "betterStripe/billing/mutations/upsertInvoice",
    );
  });

  it("throws when neither the path nor an anchor ref is available", () => {
    const component = makeComponent({ withAnchor: false });
    expect(() => componentRef(component, "billing/mutations/upsertInvoice")).toThrow(
      /Cannot resolve component path: billing\/mutations\/upsertInvoice/,
    );
  });

  it("discovers an anchor by walking nested refs when no fast-path anchor exists", () => {
    // No core.queries.getAccount / public.getAccount — only a deeply nested ref,
    // forcing findAnchorRef to walk the component tree (nested branch).
    const component = {
      billing: {
        mutations: {
          upsertSubscription: ref("billing/mutations/upsertSubscription"),
        },
      },
    } as unknown as Component;
    const result = componentRef(component, "products/mutations/upsertProduct");
    expect((result as any)[TO_REF]).toBe(
      "betterStripe/products/mutations/upsertProduct",
    );
  });

  it("discovers an anchor from a flat (two-level) ref layout", () => {
    // Old-style flat layout: comp[module][export] is the ref directly, exercising
    // findAnchorRef's flat-walk branch.
    const component = {
      extra: { getAccount: ref("extra/getAccount") },
    } as unknown as Component;
    const result = componentRef(component, "products/mutations/upsertProduct");
    expect((result as any)[TO_REF]).toBe(
      "betterStripe/products/mutations/upsertProduct",
    );
  });
});

describe("getComponentRef", () => {
  it("resolves a mapped export via direct property lookup", () => {
    const component = makeComponent({ paths: ["billing/queries/getSubscription"] });
    const result = getComponentRef(component, "billing", "getSubscription");
    expect((result as any)[TO_REF]).toBe(
      "betterStripe/billing/queries/getSubscription",
    );
  });

  it("synthesizes the mapped domain path from the anchor when not directly present", () => {
    const component = makeComponent(); // anchor only
    const result = getComponentRef(component, "billing", "upsertInvoice");
    expect((result as any)[TO_REF]).toBe(
      "betterStripe/billing/mutations/upsertInvoice",
    );
  });

  it("falls back to the same-module path for an export missing from the map", () => {
    // anchor path is betterStripe/core/queries/getAccount → the same-module
    // fallback drops the last segment and appends the export name.
    const component = makeComponent();
    const result = getComponentRef(component, "core", "someUnmappedExport");
    expect((result as any)[TO_REF]).toBe(
      "betterStripe/core/queries/someUnmappedExport",
    );
  });

  it("throws when no anchor ref exists on the component", () => {
    const component = makeComponent({ withAnchor: false });
    expect(() => getComponentRef(component, "billing", "upsertInvoice")).toThrow(
      /Cannot resolve component ref for upsertInvoice/,
    );
  });
});

describe("DISPATCHER_UPSERT_PATHS", () => {
  it.each<[TriggerDispatcherName, string]>([
    ["accountUpserted", "core/mutations/upsertAccountInternal"],
    ["productUpserted", "products/mutations/upsertProduct"],
    ["priceUpserted", "products/mutations/upsertPrice"],
    ["subscriptionUpserted", "billing/mutations/upsertSubscription"],
    ["subscriptionDeleted", "billing/mutations/upsertSubscription"],
    ["checkoutSessionUpserted", "billing/mutations/upsertCheckoutSession"],
    ["invoiceUpserted", "billing/mutations/upsertInvoice"],
    ["paymentUpserted", "connect/mutations/upsertPayment"],
    ["payoutUpserted", "connect/mutations/upsertPayout"],
  ])("maps %s to %s", (dispatcher, path) => {
    expect(DISPATCHER_UPSERT_PATHS[dispatcher]).toBe(path);
  });
});

describe("dispatchUpsert", () => {
  it("routes through syncWebhook when config.webhooks is registered", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const syncWebhook = { [TO_REF]: "app/stripe:syncWebhook" } as any;
    const whCtx = {
      ctx: { runMutation } as any,
      component: makeComponent(),
      stripe: {} as Stripe,
      webhookSecret: "whsec",
      config: { webhooks: { syncWebhook, asyncWebhook: {} as any } },
    } as unknown as WebhookContext;

    const data = { stripeInvoiceId: "in_1" };
    await dispatchUpsert(whCtx, "invoiceUpserted", data);

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(syncWebhook, {
      dispatcher: "invoiceUpserted",
      data,
    });
  });

  it("calls the component mutation directly when config.webhooks is absent", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const whCtx = {
      ctx: { runMutation } as any,
      component: makeComponent({ paths: ["billing/mutations/upsertInvoice"] }),
      stripe: {} as Stripe,
      webhookSecret: "whsec",
      // no config.webhooks
    } as unknown as WebhookContext;

    const data = { stripeInvoiceId: "in_2" };
    await dispatchUpsert(whCtx, "invoiceUpserted", data);

    expect(runMutation).toHaveBeenCalledTimes(1);
    const [refArg, payload] = runMutation.mock.calls[0];
    expect(refArg[TO_REF]).toBe("betterStripe/billing/mutations/upsertInvoice");
    expect(payload).toBe(data);
  });
});

describe("getStripeClient", () => {
  it("constructs a Stripe instance pinned to the default API version", () => {
    const client = getStripeClient("sk_test_123");
    expect(client).toBeInstanceOf(Stripe);
    expect((client as any)._api?.version).toBe(STRIPE_API_VERSION);
  });

  it("uses the provided apiVersion override", () => {
    const client = getStripeClient("sk_test_123", "2020-08-27");
    expect(client).toBeInstanceOf(Stripe);
    expect((client as any)._api?.version).toBe("2020-08-27");
  });

  it("reuses the cached client for the same secret and API version", () => {
    const first = getStripeClient("sk_test_cached", "2020-08-27");
    const second = getStripeClient("sk_test_cached", "2020-08-27");

    expect(second).toBe(first);
  });

  it("keeps different secrets and API versions isolated", () => {
    const defaultVersion = getStripeClient("sk_test_isolated");
    const overrideVersion = getStripeClient("sk_test_isolated", "2020-08-27");
    const differentSecret = getStripeClient("sk_test_isolated_other");

    expect(overrideVersion).not.toBe(defaultVersion);
    expect(differentSecret).not.toBe(defaultVersion);
  });
});
