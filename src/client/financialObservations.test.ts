// @vitest-environment edge-runtime
import { componentRef } from "./webhooks/helpers.js";
import { expect, it, vi } from "vitest";
import schema from "../component/schema.js";
import { BetterStripe } from "./index.js";
import type { RunCtx } from "./helpers.js";
import { components, initConvexTest } from "./setup.test.js";

it("exposes UNKNOWN source and owner diagnostics through the actual component without Stripe credentials", async () => {
  const t = initConvexTest();
  t.registerComponent(
    "betterStripe",
    schema,
    import.meta.glob("../component/**/*.ts"),
  );
  const client = new BetterStripe(components.betterStripe);
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  await client.financialOwnership.register(ctx, {
    bucketKey: "opaque",
    kind: "logical",
    userId: "user",
    source: { integration: "host", recordId: "fact" },
  });
  const row = await t.mutation(
    componentRef(
      components.betterStripe,
      "settlement/mutations/reserveSettlementAllocation",
    ),
    {
      sourceChargeId: "ch_sdk",
      gross: 3,
      currency: "usd",
      processingFee: 1,
      platformNet: 1,
      transfers: [{ destinationAccountId: "opaque", role: "store", amount: 1 }],
    },
  );
  expect(
    await client.financialObservations.source(ctx, { allocationId: row._id }),
  ).toMatchObject({ coverage: "unknown", observation: { generation: 1 } });
  const paginationOpts = { numItems: 25, cursor: null, id: 7 };
  expect(
    await client.financialObservations.owner(ctx, {
      userId: "user",
      paginationOpts,
    }),
  ).toMatchObject({
    coverage: "unknown",
    generation: 1,
    page: [expect.objectContaining({ bucketKey: "opaque", userId: "user" })],
  });
});
it.each([0, 101])(
  "refuses page size %i before trusted dispatch",
  async (numItems) => {
    const client = new BetterStripe(components.betterStripe);
    const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };
    await expect(
      client.financialObservations.bucket(ctx, {
        bucketKey: "opaque",
        paginationOpts: { numItems, cursor: null },
      }),
    ).rejects.toThrow();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  },
);
