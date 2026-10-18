import { creditFixture } from "./creditTransport.fixtures.js";
import { cancelCreditPurchase } from "./creditLifecycle.js";
import { componentRef } from "../webhooks/helpers.js";
import { afterEach, expect, it, vi } from "vitest";
import {
  ensureCreditPurchase,
  observeCreditPurchase,
} from "./creditProvider.js";
import type { RunCtx } from "../helpers.js";
afterEach(() => vi.useRealTimers());
it("creates an idempotent native purchase, waits for verified payment and issues one price-scoped paid grant", async () => {
  const f = creditFixture();
  await f.ready();
  const first = await f.t.action((ctx) =>
    ensureCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
  );
  expect(first.purchase.state).toBe("pending");
  expect(first.clientSecret).toContain("_secret_");
  expect(
    f.calls.some(
      (c) => c.path.includes("credit_grants") && c.method === "POST",
    ),
  ).toBe(false);
  f.state.paid = true;
  const paid = await f.t.action((ctx) =>
    observeCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
  );
  expect(paid).toMatchObject({
    state: "ready",
    creditGrantId: "credgr_topup1",
  });
  await f.t.action((ctx) =>
    observeCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
  );
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/payment_intents" && c.method === "POST",
    ),
  ).toHaveLength(1);
  const grants = f.calls.filter(
    (c) => c.path === "/v1/billing/credit_grants" && c.method === "POST",
  );
  expect(grants).toHaveLength(1);
  expect(grants[0].body.get("category")).toBe("paid");
  expect(grants[0].body.get("applicability_config[scope][prices][0][id]")).toBe(
    "price_calls",
  );
  expect(grants[0].body.get("amount[monetary][value]")).toBe("20");
});
it("preserves the grant intent after a private failure and refuses a foreign payment", async () => {
  const f = creditFixture();
  await f.ready();
  await f.t.action((ctx) =>
    ensureCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
  );
  f.state.paid = true;
  f.state.failGrant = true;
  await expect(
    f.t.action((ctx) =>
      observeCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
    ),
  ).rejects.toThrow("Native usage credits unavailable");
  f.state.failGrant = false;
  f.state.wrongPayer = true;
  await expect(
    f.t.action((ctx) =>
      observeCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
    ),
  ).rejects.toThrow(/scope|identity/i);
  f.state.wrongPayer = false;
  expect(
    await f.t.action((ctx) =>
      observeCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ state: "ready" });
});

it("starts a separate grant retry window when an original payment succeeds after a day", async () => {
  const f = creditFixture();
  await f.ready();
  await f.t.action((ctx) =>
    ensureCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
  );
  f.state.paid = true;
  vi.setSystemTime(700000 + 24 * 3600 * 1000);
  expect(
    await f.t.action((ctx) =>
      observeCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ state: "ready" });
});

it("freezes previously purchased units on verified refund evidence without granting them again", async () => {
  const f = creditFixture();
  await f.ready();
  await f.t.action((ctx) =>
    ensureCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
  );
  f.state.paid = true;
  await f.t.action((ctx) =>
    observeCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
  );
  f.state.refunded = true;
  await expect(
    f.t.action((ctx) =>
      observeCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
    ),
  ).rejects.toThrow(/recovery/i);
  const row = await f.t.action((ctx) =>
    ctx.runQuery(
      componentRef(f.component, "usageCredits/queries/getPurchase"),
      {
        bindingJson: JSON.stringify({
          scope: f.purchase.scope,
          binding: f.purchase.binding,
        }),
        purchaseId: "topup1",
      },
    ),
  );
  expect(row.state).toBe("frozen");
});

it("adopts a native grant after a database failure without creating another grant", async () => {
  const f = creditFixture();
  await f.ready();
  await f.t.action((ctx) =>
    ensureCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
  );
  f.state.paid = true;
  let failed = false;
  await expect(
    f.t.action((ctx) =>
      observeCreditPurchase(
        f.stripe,
        f.component,
        {
          ...ctx,
          runMutation: async (reference, args) => {
            if (
              String(
                (reference as unknown as Record<symbol, string>)[
                  Symbol.for("toReferencePath")
                ],
              ).endsWith("/usageCredits/mutations/pinGrant") &&
              !failed
            ) {
              failed = true;
              throw new Error("simulated database failure");
            }
            return ctx.runMutation(reference, args);
          },
        } as RunCtx,
        f.purchase,
      ),
    ),
  ).rejects.toThrow();
  expect(f.state.grant).toBeDefined();
  expect(
    await f.t.action((ctx) =>
      observeCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ state: "ready" });
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/billing/credit_grants" && c.method === "POST",
    ),
  ).toHaveLength(1);
});

it("cancels an unpaid original purchase and never recreates its payment intent", async () => {
  const f = creditFixture();
  await f.ready();
  await f.t.action((ctx) =>
    ensureCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
  );
  expect(
    await f.t.action((ctx) =>
      cancelCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ state: "canceled" });
  expect(
    await f.t.action((ctx) =>
      cancelCreditPurchase(f.stripe, f.component, ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ state: "canceled" });
  expect(
    await f.t.action((ctx) =>
      ctx.runQuery(componentRef(f.component, "usageCredits/queries/capacity"), {
        bindingJson: JSON.stringify({
          scope: f.purchase.scope,
          binding: f.purchase.binding,
        }),
      }),
    ),
  ).toBe(0);
  expect(
    f.calls.filter(
      (c) => c.path === "/v1/payment_intents" && c.method === "POST",
    ),
  ).toHaveLength(1);
});
