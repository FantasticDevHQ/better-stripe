import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";

const read = makeFunctionReference<"query">(
  "accountClosure/queries:knownBlockers",
);
const prepare = makeFunctionReference<"mutation">(
  "accountClosure/mutations:prepare",
);

it("distinguishes missing, exact and ambiguous current ownership with bounded registered reads", async () => {
  const t = convexTest(schema, modules);
  const readOwner = makeFunctionReference<"query">(
    "accountClosure/queries:currentOwner",
  );
  expect(await t.query(readOwner, { stripeAccountId: "acct_owner" })).toEqual({
    status: "missing",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("accounts", {
      stripeAccountId: "acct_owner",
      userId: "original",
      onboardingStatus: "pending",
    });
  });
  expect(await t.query(readOwner, { stripeAccountId: "acct_owner" })).toEqual({
    status: "unique",
    userId: "original",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("accounts", {
      stripeAccountId: "acct_owner",
      userId: "conflicting",
      onboardingStatus: "pending",
    });
  });
  expect(await t.query(readOwner, { stripeAccountId: "acct_owner" })).toEqual({
    status: "ambiguous",
  });
});

it.each(["usageCorrections", "usageEnrollment", "prepaidCredits"] as const)(
  "shares actual indexed %s blockers between read-only preview and close",
  async (kind) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      if (kind === "usageEnrollment")
        await ctx.db.insert("usageSubscriptionLocks", {
          key: "lock",
          intentKey: "original",
          customerAccount: "acct_target",
          stripeAccountId: "acct_realm",
        });
      if (kind === "prepaidCredits")
        await ctx.db.insert("usageCreditAccounts", {
          key: "credits",
          scopeKey: "original",
          bindingJson: "{}",
          customerAccount: "acct_target",
          stripeAccountId: "acct_realm",
          closed: false,
          purchaseCount: 0,
          historyCount: 0,
        });
      if (kind === "usageCorrections") {
        const eventId = await ctx.db.insert("usageEvents", {
          scopeKey: "original",
          identity: "event",
          recordJson: "{}",
          subscriptionJson: "{}",
          occurredAt: 1,
          acceptedAt: 1,
        });
        await ctx.db.insert("usageCorrections", {
          eventId,
          key: "correction",
          scopeKey: "original",
          customerAccount: "acct_target",
          stripeAccountId: "acct_realm",
          correctionId: "original",
          inputJson: "{}",
          recordJson: "{}",
          subscriptionJson: "{}",
          quantity: "1",
          scaledQuantity: "1",
          state: "held",
          reason: "original",
          firstAttemptAt: 1,
          attempt: 0,
          cashConsequence: "none",
          restoredQuantity: "0",
          historyCount: 0,
        });
      }
    });
    expect(await t.query(read, { stripeAccountId: "acct_target" })).toContain(
      kind,
    );
    expect(await t.query(read, { stripeAccountId: "acct_realm" })).toContain(
      kind,
    );
    expect(await t.query(read, { stripeAccountId: "acct_unrelated" })).toEqual(
      [],
    );
    await expect(
      t.mutation(prepare, { stripeAccountId: "acct_target" }),
    ).rejects.toThrow();
    expect(await t.query(read, { stripeAccountId: "acct_target" })).toContain(
      kind,
    );
  },
);
