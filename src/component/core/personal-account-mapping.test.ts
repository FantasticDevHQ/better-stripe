import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "../_generated/api.js";
import { modules, schema } from "../../test.js";

const read = makeFunctionReference<"query", { userId: string }>(
  "core/queries:getPersonalAccountMapping",
);
const account = (
  stripeAccountId = "acct_original",
  userId = "user_original",
  orgId?: string,
) => ({
  stripeAccountId,
  userId,
  onboardingStatus: "pending" as const,
  ...(orgId === undefined ? {} : { orgId }),
});
const fixture = () => convexTest(schema, modules);

describe("bounded personal account mapping", () => {
  it("returns a unique reciprocal personal account without requiring financial onboarding", async () => {
    const t = fixture();
    const id = await t.run((ctx) => ctx.db.insert("accounts", account()));
    expect(await t.query(read, { userId: "user_original" })).toEqual({
      status: "unique",
      account: expect.objectContaining({
        _id: id,
        stripeAccountId: "acct_original",
        userId: "user_original",
        onboardingStatus: "pending",
      }),
    });
  });

  it("distinguishes a missing mapping from a guessed current account", async () => {
    expect(await fixture().query(read, { userId: "user_missing" })).toEqual({
      status: "unavailable",
      reason: "missing",
    });
  });

  it.each([
    "same user",
    "same Stripe ID",
    "same exact mapping",
    "mixed organization",
  ] as const)(
    "rejects ambiguous %s instead of selecting the first row",
    async (kind) => {
      const t = fixture();
      await t.run(async (ctx) => {
        await ctx.db.insert("accounts", account());
        await ctx.db.insert(
          "accounts",
          kind === "same user"
            ? account("acct_replacement")
            : kind === "same Stripe ID"
              ? account("acct_original", "user_other")
              : kind === "mixed organization"
                ? account("acct_organization", "user_original", "org_one")
                : account(),
        );
      });
      expect(await t.query(read, { userId: "user_original" })).toEqual({
        status: "unavailable",
        reason: "ambiguous",
      });
      expect(
        (
          await t.query(api.core.queries.getAccountByUserId, {
            userId: "user_original",
          })
        )?.stripeAccountId,
      ).toBe("acct_original");
    },
  );

  it.each(["org_one", ""])(
    "never treats organization scope %j as personal",
    async (orgId) => {
      const t = fixture();
      await t.run((ctx) =>
        ctx.db.insert(
          "accounts",
          account("acct_original", "user_original", orgId),
        ),
      );
      expect(await t.query(read, { userId: "user_original" })).toEqual({
        status: "unavailable",
        reason: "organization",
      });
    },
  );

  it.each(["acct_", "cus_123", "acct_bad space", "acct_" + "x".repeat(129)])(
    "rejects malformed provider account %j",
    async (stripeAccountId) => {
      const t = fixture();
      await t.run((ctx) => ctx.db.insert("accounts", account(stripeAccountId)));
      expect(await t.query(read, { userId: "user_original" })).toEqual({
        status: "unavailable",
        reason: "invalid_account",
      });
    },
  );

  it.each(["closed", "pending"] as const)(
    "excludes a stale live row with %s closure provenance",
    async (state) => {
      const t = fixture();
      await t.run(async (ctx) => {
        await ctx.db.insert("accounts", account());
        await ctx.db.insert("accountClosures", {
          stripeAccountId: "acct_original",
          userId: "user_original",
          state,
        });
      });
      expect(await t.query(read, { userId: "user_original" })).toEqual({
        status: "unavailable",
        reason: state === "closed" ? "closed" : "closure_unresolved",
      });
    },
  );

  it("rejects conflicting closure records rather than choosing one", async () => {
    const t = fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("accounts", account());
      for (const state of ["pending", "closed"] as const)
        await ctx.db.insert("accountClosures", {
          stripeAccountId: "acct_original",
          userId: "user_original",
          state,
        });
    });
    expect(await t.query(read, { userId: "user_original" })).toEqual({
      status: "unavailable",
      reason: "ambiguous",
    });
  });

  it.each([
    "",
    " ",
    " user_original",
    "user_original ",
    "user\noriginal",
    "x".repeat(257),
  ])("rejects malformed user selector %j", async (userId) => {
    await expect(fixture().query(read, { userId })).rejects.toThrow(
      "Invalid personal account user selector",
    );
  });

  it("does not leak another user's mapping or mutate account state", async () => {
    const t = fixture();
    const before = await t.run(async (ctx) => {
      await ctx.db.insert("accounts", account());
      return ctx.db.query("accounts").take(2);
    });
    expect(await t.query(read, { userId: "user_other" })).toEqual({
      status: "unavailable",
      reason: "missing",
    });
    expect(await t.run((ctx) => ctx.db.query("accounts").take(2))).toEqual(
      before,
    );
  });
});
