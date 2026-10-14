// @vitest-environment edge-runtime
import type Stripe from "stripe";
import { convexTest } from "convex-test";
import { componentsGeneric, defineSchema } from "convex/server";
import { expect, it, vi } from "vitest";
import componentSchema from "../../component/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { createAccount, getOrCreateAccount } from "./accounts.js";
const modules = import.meta.glob("../../component/**/*.*s");
it("reuses one provider account for concurrent calls and recovers a persistence failure", async () => {
  const t = convexTest(defineSchema({}), modules);
  t.registerComponent("betterStripe", componentSchema, modules);
  const component = componentsGeneric().betterStripe as unknown as Component;
  const provider = new Map<string, { params: string; id: string }>();
  let created = 0;
  const sdk = {
    v2: {
      core: {
        accounts: {
          create: vi.fn(
            async (params: unknown, options?: { idempotencyKey?: string }) => {
              const key = options?.idempotencyKey ?? `unkeyed-${++created}`,
                existing = provider.get(key),
                fingerprint = JSON.stringify(params);
              if (existing && existing.params !== fingerprint)
                throw new Error("idempotency_error");
              if (existing) return { id: existing.id };
              const value = { params: fingerprint, id: `acct_${++created}` };
              provider.set(key, value);
              return { id: value.id };
            },
          ),
        },
      },
    },
  };
  let fail = true;
  const ctx: RunCtx = {
    runQuery: t.query as RunCtx["runQuery"],
    runMutation: (async (
      ref: Parameters<typeof t.mutation>[0],
      args: Record<string, unknown>,
    ) => {
      if (fail) {
        fail = false;
        throw new Error("persistence unavailable");
      }
      return t.mutation(ref, args);
    }) as RunCtx["runMutation"],
  };
  const opts = {
    userId: "buyer",
    email: "buyer@example.com",
    idempotencyKey: "account:buyer:v1",
  };
  await expect(
    createAccount(sdk as unknown as Stripe, component, ctx, opts),
  ).rejects.toThrow("persistence unavailable");
  const [a, b] = await Promise.all([
    getOrCreateAccount(sdk as unknown as Stripe, component, ctx, opts),
    getOrCreateAccount(sdk as unknown as Stripe, component, ctx, opts),
  ]);
  expect(a.stripeAccountId).toBe(b.stripeAccountId);
  expect(provider.size).toBe(1);
  expect(sdk.v2.core.accounts.create).toHaveBeenCalledWith(expect.anything(), {
    idempotencyKey: opts.idempotencyKey,
  });
  await expect(
    createAccount(sdk as unknown as Stripe, component, ctx, {
      ...opts,
      email: "changed@example.com",
    }),
  ).rejects.toThrow("idempotency_error");
  const row = await t.query(component.core.queries.getAccountByUserId, {
    userId: "buyer",
  });
  expect(row?.stripeAccountId).toBe(a.stripeAccountId);
});
