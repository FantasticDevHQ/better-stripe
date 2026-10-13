/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.*s");
it("starts once and resumes failed work without duplicating completed steps", async () => {
  const t = convexTest(schema, modules);
  const job = await t.mutation(internal.sandboxFixtureState.begin, {
    total: 3,
  });
  expect(job?.cursor).toBe(0);
  expect(
    await t.mutation(internal.sandboxFixtureState.begin, { total: 3 }),
  ).toBeNull();
  await t.mutation(internal.sandboxFixtureState.advance, job!);
  await t.mutation(internal.sandboxFixtureState.failure, {
    jobId: job!.jobId,
    cursor: 1,
    error: "Stripe temporarily unavailable",
    retry: false,
  });
  expect(
    await t.mutation(internal.sandboxFixtureState.begin, { total: 3 }),
  ).toEqual({ jobId: job!.jobId, cursor: 1 });
  expect((await t.query(api.sandboxFixtureState.status))?.status).toBe(
    "running",
  );
});
it("never repeats a completed dataset or advances a stale worker", async () => {
  const t = convexTest(schema, modules);
  const job = (await t.mutation(internal.sandboxFixtureState.begin, {
    total: 1,
  }))!;
  expect(await t.mutation(internal.sandboxFixtureState.advance, job)).toBe(
    false,
  );
  expect(await t.mutation(internal.sandboxFixtureState.advance, job)).toBe(
    false,
  );
  expect(
    await t.mutation(internal.sandboxFixtureState.begin, { total: 1 }),
  ).toBeNull();
  expect((await t.query(api.sandboxFixtureState.status))?.cursor).toBe(1);
});
it("keeps a durable Stripe resource identity beyond Stripe's idempotency window", async () => {
  const t = convexTest(schema, modules);
  const resource = {
    key: "fixture:acct_store:sale:1",
    stripeId: "pi_fixture",
    kind: "payment",
  };
  await t.mutation(internal.sandboxFixtureState.saveResource, resource);
  await t.mutation(internal.sandboxFixtureState.saveResource, resource);
  expect(
    await t.query(internal.sandboxFixtureState.resource, { key: resource.key }),
  ).toBe(resource.stripeId);
  await expect(
    t.mutation(internal.sandboxFixtureState.saveResource, {
      ...resource,
      stripeId: "pi_duplicate",
    }),
  ).rejects.toThrow(/already exists/);
});
