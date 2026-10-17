import { modules } from "../../../test";
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";

it("rejects signed-out billing history before reading any component data", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.query(api.billing.history.queries.subscriptions, {
      paginationOpts: { cursor: null, numItems: 10 },
    }),
  ).rejects.toThrow("Authentication required");
});

it("rejects a signed identity with no uniquely enabled example buyer", async () => {
  const t = convexTest(schema, modules);
  const caller = t.withIdentity({
    subject: "missing",
    tokenIdentifier: "missing_token",
  });
  await expect(
    caller.query(api.billing.history.queries.checkoutSessions, {
      paginationOpts: { cursor: null, numItems: 10 },
    }),
  ).rejects.toThrow("Authentication required");
});

it("rejects duplicate authenticated mappings and visitor personas", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 2; i++)
      await ctx.db.insert("users", {
        name: "Duplicate",
        email: `duplicate${i}@example.invalid`,
        role: "buyer",
        authTokenIdentifier: "duplicate",
      });
    await ctx.db.insert("users", {
      name: "Visitor",
      email: "visitor@example.invalid",
      role: "visitor",
      authTokenIdentifier: "visitor",
    });
  });
  for (const tokenIdentifier of ["duplicate", "visitor"])
    await expect(
      t
        .withIdentity({ subject: tokenIdentifier, tokenIdentifier })
        .query(api.billing.history.queries.subscriptions, {
          paginationOpts: { cursor: null, numItems: 1 },
        }),
    ).rejects.toThrow("Authentication required");
});
