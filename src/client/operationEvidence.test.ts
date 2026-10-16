// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import schema from "../component/schema.js";
import { BetterStripe } from "./index.js";
import type { RunCtx } from "./helpers.js";
import { components, initConvexTest } from "./setup.test.js";
import { componentRef } from "./webhooks/helpers.js";

it("captures and reads lossless evidence through the actual public SDK and component", async () => {
  const t = initConvexTest();
  t.registerComponent(
    "betterStripe",
    schema,
    import.meta.glob("../component/**/*.ts"),
  );
  const client = new BetterStripe(components.betterStripe);
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  const operationId = "\u0000".repeat(5000);
  await t.mutation(
    componentRef(
      components.betterStripe,
      "connect/mutations/claimReversalSlices",
    ),
    { operationId, sourceChargeId: "charge", mode: { kind: "full" } },
  );
  const source = await t.query(
    componentRef(components.betterStripe, "connect/queries/getReversalOp"),
    { operationId },
  );
  const saved = await client.operationEvidence.capture(ctx, {
    sourceId: source._id,
  });
  expect(saved).toMatchObject({
    coverage: "unknown",
    status: "captured",
    evidenceGeneration: 1,
  });
  expect(
    (
      await client.operationEvidence.original(ctx, {
        headerId: saved.header!._id,
      })
    ).payload?.operationId,
  ).toBe(operationId);
  expect(
    (
      await client.operationEvidence.latest(ctx, {
        headerId: saved.header!._id,
      })
    ).payload?.slices,
  ).toEqual([]);
  expect(
    (
      await client.operationEvidence.resolve(ctx, {
        selector: "operationId",
        value: operationId,
      })
    ).header?._id,
  ).toBe(saved.header!._id);
  expect(
    (
      await client.operationEvidence.headers(ctx, {
        paginationOpts: { numItems: 1, cursor: null, id: 9 },
      })
    ).page,
  ).toHaveLength(1);
});

it("rejects invented source bytes and page expansion before dispatch while retaining admitted selectors", async () => {
  const client = new BetterStripe(components.betterStripe);
  const ctx = {
    runQuery: vi.fn().mockResolvedValue({
      coverage: "unknown",
      evidenceGeneration: 0,
      header: null,
    }),
    runMutation: vi.fn(),
  };
  await expect(
    client.operationEvidence.capture(ctx, {
      sourceId: "source",
      payload: { operationId: "invented" },
    } as never),
  ).rejects.toThrow();
  await expect(
    client.operationEvidence.capture(ctx, { sourceId: "" }),
  ).rejects.toThrow();
  await expect(
    client.operationEvidence.original(ctx, {
      headerId: "",
      payloadIds: ["one", "two"],
    } as never),
  ).rejects.toThrow();
  await expect(
    client.operationEvidence.headers(ctx, {
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow();
  expect(ctx.runMutation).not.toHaveBeenCalled();
  expect(ctx.runQuery).not.toHaveBeenCalled();
  await client.operationEvidence.resolve(ctx, {
    selector: "operationId",
    value: "",
  });
  await client.operationEvidence.resolve(ctx, {
    selector: "operationId",
    value: "\u0000".repeat(5000),
  });
  expect(ctx.runQuery).toHaveBeenCalledTimes(2);
});
