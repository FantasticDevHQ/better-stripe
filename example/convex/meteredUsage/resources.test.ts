import type { FunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { demoConfiguration } from "./policy";
import * as resources from "./resources";
beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function setup() {
  const t = convexTest(schema, modules);
  const actorId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Fixture test",
      email: "fixture@example.invalid",
      role: "customer",
    }),
  );
  const runId = await t.mutation(internal.meteredUsage.state.begin, {
    actorId,
    model: "pay_as_you_go",
    configurationJson: JSON.stringify(demoConfiguration("pay_as_you_go")),
  });
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as unknown as ActionCtx;
  return { t, ctx, ref: { actorId, runId } };
}
it("recovers provider success/database failure with the exact retained operation key", async () => {
  expect(resources.ensureDemoResource).toBeTypeOf("function");
  const { t, ctx, ref } = await setup();
  const keys: string[] = [];
  let fail = true;
  const faultCtx = {
    ...ctx,
    runMutation: async (fn: unknown, args: Record<string, unknown>) => {
      if (args.stripeId && fail) {
        fail = false;
        throw new Error("database unavailable after provider success");
      }
      return t.mutation(
        fn as FunctionReference<
          "mutation",
          "internal",
          Record<string, unknown>
        >,
        args,
      );
    },
  } as unknown as ActionCtx;
  const create = async (key: string) => {
    keys.push(key);
    return { id: "clock_original" };
  };
  const retrieve = vi.fn(async () => ({ id: "clock_original" }));
  await expect(
    resources.ensureDemoResource(faultCtx, ref, "clock", retrieve, create),
  ).rejects.toThrow(/database/);
  expect(
    await resources.ensureDemoResource(ctx, ref, "clock", retrieve, create),
  ).toEqual({ id: "clock_original" });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(
    await resources.ensureDemoResource(ctx, ref, "clock", retrieve, create),
  ).toEqual({ id: "clock_original" });
  expect(keys).toHaveLength(2);
  expect(retrieve).toHaveBeenCalledWith("clock_original");
});
it("stops unknown creates at the safe retry window while permitting pinned reads", async () => {
  expect(resources.ensureDemoResource).toBeTypeOf("function");
  const { t, ctx, ref } = await setup();
  const intent = await t.mutation(internal.meteredUsage.state.prepareResource, {
    ...ref,
    kind: "clock",
  });
  vi.spyOn(Date, "now").mockReturnValue(intent.createdAt + 23 * 3600 * 1000);
  const create = vi.fn(async () => ({ id: "clock_new" }));
  const retrieve = vi.fn(async () => ({ id: "clock_original" }));
  await expect(
    resources.ensureDemoResource(ctx, ref, "clock", retrieve, create),
  ).rejects.toThrow(/reconcile/i);
  expect(create).not.toHaveBeenCalled();
  await t.mutation(internal.meteredUsage.state.pinResource, {
    ...ref,
    kind: "clock",
    stripeId: "clock_original",
  });
  expect(
    await resources.ensureDemoResource(ctx, ref, "clock", retrieve, create),
  ).toEqual({ id: "clock_original" });
});
it("never recreates a missing pinned resource or accepts a changed returned ID", async () => {
  expect(resources.ensureDemoResource).toBeTypeOf("function");
  const { t, ctx, ref } = await setup();
  await t.mutation(internal.meteredUsage.state.prepareResource, {
    ...ref,
    kind: "clock",
  });
  await t.mutation(internal.meteredUsage.state.pinResource, {
    ...ref,
    kind: "clock",
    stripeId: "clock_original",
  });
  const create = vi.fn(async () => ({ id: "clock_new" }));
  await expect(
    resources.ensureDemoResource(
      ctx,
      ref,
      "clock",
      async () => {
        throw new Error("missing");
      },
      create,
    ),
  ).rejects.toThrow("missing");
  await expect(
    resources.ensureDemoResource(
      ctx,
      ref,
      "clock",
      async () => ({ id: "clock_foreign" }),
      create,
    ),
  ).rejects.toThrow(/identity/i);
  expect(create).not.toHaveBeenCalled();
});
