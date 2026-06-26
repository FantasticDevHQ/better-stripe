/**
 * Tests for the invoice methods. These are thin wrappers over component
 * queries/mutations and one Stripe SDK call, but each carries real behavior
 * worth pinning: `listInvoices` renames `stripeAccountId` → `accountId` and
 * only forwards it when defined; `listInvoicesByUser` forwards a single field;
 * `upsertInvoice` routes through `runMutationOrThrow` (which guards on
 * `ctx.runMutation`) and returns null; `getInvoice` queries by stripe id and
 * passes through null; `getInvoiceFromStripe` delegates to the SDK. Tests
 * assert the exact ref resolved, the exact params forwarded, and the returned
 * shape for every branch.
 */
import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import {
  getInvoice,
  getInvoiceFromStripe,
  listInvoices,
  listInvoicesByUser,
  upsertInvoice,
} from "./invoices.js";

const TO_REF = Symbol.for("toReferencePath");

/** Component proxy exposing the billing invoice refs these functions resolve. */
function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    billing: {
      queries: {
        getInvoiceByStripeId: ref("billing/queries/getInvoiceByStripeId"),
        listInvoices: ref("billing/queries/listInvoices"),
      },
      mutations: {
        upsertInvoice: ref("billing/mutations/upsertInvoice"),
      },
    },
  } as unknown as Component;
}

function refPath(component: Component, path: string): string {
  const parts = path.split("/");
  let node: any = component;
  for (const part of parts) node = node?.[part];
  return node[TO_REF];
}

function makeCtx(queryResult?: unknown) {
  return {
    runQuery: vi.fn().mockResolvedValue(queryResult),
    runMutation: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunCtx & {
    runQuery: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };
}

function makeStripe() {
  return {
    invoices: {
      retrieve: vi.fn(),
    },
  };
}

const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof getInvoiceFromStripe>[0];

describe("listInvoices", () => {
  it("resolves the listInvoices query ref and defaults opts to an empty arg object", async () => {
    const component = makeComponent();
    const ctx = makeCtx([]);

    const result = await listInvoices(component, ctx);

    expect(result).toEqual([]);
    const [ref, args] = ctx.runQuery.mock.calls[0];
    expect(ref[TO_REF]).toBe(refPath(component, "billing/queries/listInvoices"));
    expect(args).toEqual({});
  });

  it("renames stripeAccountId to accountId and forwards the other filters", async () => {
    const rows = [{ stripeInvoiceId: "in_1" }];
    const ctx = makeCtx(rows);

    const result = await listInvoices(makeComponent(), ctx, {
      stripeAccountId: "acct_123",
      userId: "user_1",
      subscriptionId: "sub_1",
      status: "paid",
      limit: 10,
    });

    expect(result).toBe(rows);
    const [, args] = ctx.runQuery.mock.calls[0];
    expect(args).toEqual({
      userId: "user_1",
      subscriptionId: "sub_1",
      status: "paid",
      limit: 10,
      accountId: "acct_123",
    });
    // the original stripeAccountId key must not leak through
    expect(args).not.toHaveProperty("stripeAccountId");
  });

  it("omits accountId entirely when stripeAccountId is undefined", async () => {
    const ctx = makeCtx([]);

    await listInvoices(makeComponent(), ctx, { userId: "user_2", limit: 5 });

    const [, args] = ctx.runQuery.mock.calls[0];
    expect(args).toEqual({ userId: "user_2", limit: 5 });
    expect(args).not.toHaveProperty("accountId");
  });
});

describe("listInvoicesByUser", () => {
  it("queries listInvoices with only the userId and returns the rows", async () => {
    const component = makeComponent();
    const rows = [{ stripeInvoiceId: "in_2" }];
    const ctx = makeCtx(rows);

    const result = await listInvoicesByUser(component, ctx, { userId: "u_9" });

    expect(result).toBe(rows);
    const [ref, args] = ctx.runQuery.mock.calls[0];
    expect(ref[TO_REF]).toBe(refPath(component, "billing/queries/listInvoices"));
    expect(args).toEqual({ userId: "u_9" });
  });
});

describe("upsertInvoice", () => {
  const baseOpts = {
    stripeInvoiceId: "in_3",
    userId: "u_1",
    status: "open" as const,
    currency: "usd",
    amountDue: 2000,
    amountPaid: 0,
  };

  it("runs the upsert mutation with the full opts and returns null", async () => {
    const component = makeComponent();
    const ctx = makeCtx();

    const result = await upsertInvoice(component, ctx, baseOpts);

    expect(result).toBeNull();
    const [ref, args] = ctx.runMutation.mock.calls[0];
    expect(ref[TO_REF]).toBe(
      refPath(component, "billing/mutations/upsertInvoice"),
    );
    expect(args).toEqual(baseOpts);
  });

  it("forwards every optional field verbatim to the mutation", async () => {
    const ctx = makeCtx();
    const opts = {
      ...baseOpts,
      orgId: "org_1",
      accountId: "acct_1",
      subscriptionId: "sub_1",
      hostedInvoiceUrl: "https://stripe.test/inv",
      invoicePdf: "https://stripe.test/inv.pdf",
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-02-01T00:00:00.000Z",
      metadata: { tier: "pro" },
    };

    await upsertInvoice(makeComponent(), ctx, opts);

    const [, args] = ctx.runMutation.mock.calls[0];
    expect(args).toEqual(opts);
  });

  it("throws when ctx has no runMutation (runMutationOrThrow guard)", async () => {
    const ctx = { runQuery: vi.fn() } as unknown as RunCtx;

    await expect(
      upsertInvoice(makeComponent(), ctx, baseOpts),
    ).rejects.toThrow(/requires a Convex ctx with runMutation/);
  });
});

describe("getInvoice", () => {
  it("queries getInvoiceByStripeId and returns the matched row", async () => {
    const component = makeComponent();
    const row = { stripeInvoiceId: "in_4", status: "paid" };
    const ctx = makeCtx(row);

    const result = await getInvoice(component, ctx, { stripeInvoiceId: "in_4" });

    expect(result).toBe(row);
    const [ref, args] = ctx.runQuery.mock.calls[0];
    expect(ref[TO_REF]).toBe(
      refPath(component, "billing/queries/getInvoiceByStripeId"),
    );
    expect(args).toEqual({ stripeInvoiceId: "in_4" });
  });

  it("passes through null when no invoice matches", async () => {
    const ctx = makeCtx(null);

    const result = await getInvoice(makeComponent(), ctx, {
      stripeInvoiceId: "in_missing",
    });

    expect(result).toBeNull();
  });
});

describe("getInvoiceFromStripe", () => {
  it("retrieves the invoice from the Stripe SDK and returns it", async () => {
    const stripe = makeStripe();
    const invoice = { id: "in_5", status: "paid" };
    stripe.invoices.retrieve.mockResolvedValue(invoice);
    const ctx = makeCtx();

    const result = await getInvoiceFromStripe(asStripe(stripe), ctx, {
      stripeInvoiceId: "in_5",
    });

    expect(result).toBe(invoice);
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith("in_5");
  });

  it("propagates errors thrown by the Stripe SDK", async () => {
    const stripe = makeStripe();
    stripe.invoices.retrieve.mockRejectedValue(new Error("no such invoice"));
    const ctx = makeCtx();

    await expect(
      getInvoiceFromStripe(asStripe(stripe), ctx, { stripeInvoiceId: "in_x" }),
    ).rejects.toThrow("no such invoice");
  });
});
