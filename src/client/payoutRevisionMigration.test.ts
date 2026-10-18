// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import schema from "../component/schema.js";
import { BetterStripe } from "./index.js";
import type { RunCtx } from "./helpers.js";
import { components, initConvexTest } from "./setup.test.js";
const modules = import.meta.glob("../component/**/*.ts");
it("runs the trusted migration through the public facade without Stripe or financial writes", async () => {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const client = new BetterStripe(components.betterStripe);
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  const migration = client.payoutRevisionMigration;
  expect(await migration.activateAccount(ctx, { accountId: "opaque" })).toEqual(
    { accountId: "opaque", status: "activated" },
  );
  let job = await migration.begin(ctx, { operationKey: "public-pass" });
  expect(await migration.get(ctx, { jobId: job._id })).toEqual(job);
  while (job.status !== "finished")
    job = await migration.resume(ctx, {
      jobId: job._id,
      expectedStep: job.step,
    });
  expect(job).toMatchObject({ status: "finished", visited: 0 });
  expect(
    await migration.results(ctx, {
      jobId: job._id,
      paginationOpts: { numItems: 1, cursor: null },
    }),
  ).toMatchObject({ page: [], isDone: true });
  expect(() =>
    migration.resume(ctx, { jobId: job._id, expectedStep: -1 }),
  ).toThrow();
  expect(() =>
    migration.results(ctx, {
      jobId: job._id,
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).toThrow();
});
