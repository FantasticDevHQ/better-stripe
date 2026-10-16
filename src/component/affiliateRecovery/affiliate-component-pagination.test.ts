// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { componentDb } from "../../testing/component-db.js";
import { expect, it } from "vitest";
import type {
  RegisteredQuery,
  RegisteredMutation,
  DefaultFunctionArgs,
} from "convex/server";
import type { MutationCtx } from "../_generated/server.js";
import { schema, modules } from "../../test.js";
import { recoverySnapshot, pendingOperations } from "./queries.js";
import { listAffiliateObligations } from "../settlement/queries.js";
import { migrateAffiliateObligations } from "../settlement/mutations.js";

function handler<Args extends DefaultFunctionArgs, Result>(
  fn:
    | RegisteredQuery<"public", Args, Result>
    | RegisteredMutation<"public", Args, Result>,
) {
  return (
    fn as unknown as { _handler: (ctx: MutationCtx, args: Args) => Result }
  )._handler;
}

it("reads recovery pages and migrates inside the deployed component pagination boundary", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const componentCtx = { ...ctx, db: componentDb(ctx.db) };
    const paginationOpts = { numItems: 10, cursor: null };
    expect(
      await handler(listAffiliateObligations)(componentCtx, {
        affiliateAccountId: "acct_a",
        currency: "usd",
        paginationOpts,
      }),
    ).toMatchObject({ page: [], isDone: true });
    const snapshot = await handler(recoverySnapshot)(componentCtx, {
      affiliateAccountId: "acct_a",
      currency: "usd",
      paginationOpts,
    });
    expect(snapshot.obligations).toMatchObject({ page: [], isDone: true });
    expect(
      await handler(pendingOperations)(componentCtx, {
        state: "unknown",
        paginationOpts,
      }),
    ).toMatchObject({ page: [], isDone: true });
    expect(
      await handler(migrateAffiliateObligations)(componentCtx, {
        paginationOpts,
      }),
    ).toMatchObject({ migrated: 0, isDone: true });
  });
});
