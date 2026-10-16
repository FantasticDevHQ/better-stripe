import { modules } from "../../../test";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
it("starts once and resumes failed work without duplicating completed steps", async () => {
  const t = convexTest(schema, modules);
  const job = await t.mutation(
    internal.sandboxFixtures.state.internal.mutations.begin,
    {
      total: 3,
    },
  );
  expect(job?.cursor).toBe(0);
  expect(
    await t.mutation(internal.sandboxFixtures.state.internal.mutations.begin, {
      total: 3,
    }),
  ).toBeNull();
  await t.mutation(
    internal.sandboxFixtures.state.internal.mutations.advance,
    job!,
  );
  await t.mutation(internal.sandboxFixtures.state.internal.mutations.failure, {
    jobId: job!.jobId,
    cursor: 1,
    error: "Stripe temporarily unavailable",
    retry: false,
  });
  expect(
    await t.mutation(internal.sandboxFixtures.state.internal.mutations.begin, {
      total: 3,
    }),
  ).toEqual({ jobId: job!.jobId, cursor: 1 });
  expect(
    (await t.query(api.sandboxFixtures.state.public.queries.status))?.status,
  ).toBe("running");
});
it("never repeats a completed dataset or advances a stale worker", async () => {
  const t = convexTest(schema, modules);
  const job = (await t.mutation(
    internal.sandboxFixtures.state.internal.mutations.begin,
    {
      total: 1,
    },
  ))!;
  expect(
    await t.mutation(
      internal.sandboxFixtures.state.internal.mutations.advance,
      job,
    ),
  ).toBe(false);
  expect(
    await t.mutation(
      internal.sandboxFixtures.state.internal.mutations.advance,
      job,
    ),
  ).toBe(false);
  expect(
    await t.mutation(internal.sandboxFixtures.state.internal.mutations.begin, {
      total: 1,
    }),
  ).toBeNull();
  expect(
    (await t.query(api.sandboxFixtures.state.public.queries.status))?.cursor,
  ).toBe(1);
});
it("keeps a durable Stripe resource identity beyond Stripe's idempotency window", async () => {
  const t = convexTest(schema, modules);
  const resource = {
    key: "fixture:acct_store:sale:1",
    stripeId: "pi_fixture",
    kind: "payment",
  };
  await t.mutation(
    internal.sandboxFixtures.state.internal.mutations.saveResource,
    resource,
  );
  await t.mutation(
    internal.sandboxFixtures.state.internal.mutations.saveResource,
    resource,
  );
  expect(
    await t.query(internal.sandboxFixtures.state.internal.queries.resource, {
      key: resource.key,
    }),
  ).toBe(resource.stripeId);
  await expect(
    t.mutation(internal.sandboxFixtures.state.internal.mutations.saveResource, {
      ...resource,
      stripeId: "pi_duplicate",
    }),
  ).rejects.toThrow(/already exists/);
});
