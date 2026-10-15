// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import type {
  RegisteredQuery,
  RegisteredMutation,
  DefaultFunctionArgs,
} from "convex/server";
import type { MutationCtx } from "./_generated/server.js";
import schema from "./schema.js";
import {
  recoverySnapshot,
  pendingOperations,
} from "./affiliateRecovery/queries.js";
import { listAffiliateObligations } from "./settlement/queries.js";
import { migrateAffiliateObligations } from "./settlement/mutations.js";

function handler<Args extends DefaultFunctionArgs, Result>(
  fn:
    | RegisteredQuery<"public", Args, Result>
    | RegisteredMutation<"public", Args, Result>,
) {
  return (
    fn as unknown as { _handler: (ctx: MutationCtx, args: Args) => Result }
  )._handler;
}

// convex-test supports native pagination even though deployed components do not.
// Make that runtime restriction explicit while exercising real indexed reads.
function componentDb<T extends object>(db: T): T {
  function wrap<TValue extends object>(value: TValue): TValue {
    return new Proxy(value, {
      get(target, key) {
        if (key === "paginate")
          return () => {
            throw new Error("paginate() is only supported in the app");
          };
        const member = Reflect.get(target, key);
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          const result = member.apply(target, args);
          return result &&
            typeof result === "object" &&
            !(result instanceof Promise)
            ? wrap(result)
            : result;
        };
      },
    });
  }
  return wrap(db);
}
it("reads recovery pages and migrates inside the deployed component pagination boundary", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
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
