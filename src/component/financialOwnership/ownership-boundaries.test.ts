import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { modules, schema } from "../../test.js";
const register = makeFunctionReference<"mutation">(
  "financialOwnership/mutations:register",
);
const lookup = makeFunctionReference<"query">(
  "financialOwnership/queries:lookup",
);
const discover = makeFunctionReference<"query">(
  "financialOwnership/queries:discover",
);
const physical = {
  bucketKey: "acct_one",
  kind: "stripe_account",
  userId: "user_one",
};
const logical = {
  bucketKey: "unassigned:key",
  kind: "logical",
  userId: "user_one",
  source: { integration: "trusted-host", recordId: "source_one" },
};
const account = {
  stripeAccountId: "acct_one",
  userId: "user_one",
  onboardingStatus: "pending" as const,
};
const fixture = () => convexTest(schema, modules);

describe("physical ownership proof and isolation", () => {
  it.each([
    "missing",
    "foreign",
    "duplicate_user",
    "duplicate_provider",
    "organization",
    "pending_closure",
  ])("rejects %s current proof atomically", async (kind) => {
    const t = fixture();
    await t.run(async (ctx) => {
      if (kind !== "missing")
        await ctx.db.insert("accounts", {
          ...account,
          ...(kind === "foreign" ? { userId: "other" } : {}),
          ...(kind === "organization" ? { orgId: "org_one" } : {}),
        });
      if (kind === "duplicate_user")
        await ctx.db.insert("accounts", {
          ...account,
          stripeAccountId: "acct_two",
        });
      if (kind === "duplicate_provider")
        await ctx.db.insert("accounts", { ...account, userId: "other" });
      if (kind === "pending_closure")
        await ctx.db.insert("accountClosures", {
          stripeAccountId: account.stripeAccountId,
          userId: account.userId,
          state: "pending",
        });
    });
    await expect(t.mutation(register, physical)).rejects.toThrow();
    expect(await t.query(lookup, { bucketKey: physical.bucketKey })).toEqual({
      status: "unknown",
      coverage: "unknown",
    });
    expect(
      await t.query(discover, {
        userId: physical.userId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).toMatchObject({ generation: 0, page: [], coverage: "unknown" });
  });
  it("preserves historical closure ownership without reviving active discovery", async () => {
    const t = fixture();
    await t.run((ctx) =>
      ctx.db.insert("accountClosures", {
        stripeAccountId: account.stripeAccountId,
        userId: account.userId,
        state: "closed",
        closedAt: 10,
      }),
    );
    const result = await t.mutation(register, physical);
    expect(result).toMatchObject({
      coverage: "unknown",
      registration: {
        userId: account.userId,
        source: { integration: "component-closure" },
      },
    });
    expect(await t.run((ctx) => ctx.db.query("accounts").take(2))).toEqual([]);
  });
  it.each(["duplicate", "foreign", "ownerless", "pending", "conflicting_live"])(
    "rejects %s historical proof",
    async (kind) => {
      const t = fixture();
      await t.run(async (ctx) => {
        const closure = {
          stripeAccountId: account.stripeAccountId,
          ...(kind === "ownerless"
            ? {}
            : { userId: kind === "foreign" ? "other" : account.userId }),
          state:
            kind === "pending" ? ("pending" as const) : ("closed" as const),
        };
        await ctx.db.insert("accountClosures", closure);
        if (kind === "duplicate")
          await ctx.db.insert("accountClosures", closure);
        if (kind === "conflicting_live")
          await ctx.db.insert("accounts", { ...account, userId: "other" });
      });
      await expect(t.mutation(register, physical)).rejects.toThrow();
    },
  );
  it("keeps organization registration separate from personal owner discovery", async () => {
    const t = fixture();
    await t.run((ctx) =>
      ctx.db.insert("accounts", { ...account, orgId: "org_one" }),
    );
    const result = await t.mutation(register, {
      ...physical,
      orgId: "org_one",
    });
    expect(result).toMatchObject({ registration: { orgId: "org_one" } });
    const personal = await t.query(discover, {
      userId: physical.userId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(personal).toMatchObject({
      page: [],
      generation: 0,
      coverage: "unknown",
    });
    expect(
      await t.query(discover, {
        userId: physical.userId,
        orgId: "org_one",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).toMatchObject({ page: [result.registration], generation: 1 });
    await expect(
      t.mutation(register, { ...physical, orgId: "org_other" }),
    ).rejects.toThrow("immutable");
  });
  it("rejects ambiguous organization scope instead of selecting its first mapping", async () => {
    const t = fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("accounts", { ...account, orgId: "org_one" });
      await ctx.db.insert("accounts", {
        ...account,
        stripeAccountId: "acct_two",
        orgId: "org_one",
      });
    });
    await expect(
      t.mutation(register, { ...physical, orgId: "org_one" }),
    ).rejects.toThrow("unavailable");
  });
});

describe("immutable registry and bounded discovery", () => {
  it("retains byte-identical financial rows and the original receipt through closure replay", async () => {
    const t = fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("accounts", account);
      await ctx.db.insert("transfers", {
        stripeTransferId: "tr_original",
        sourceChargeId: "ch_original",
        destinationAccountId: "acct_one",
        amount: 125,
        currency: "jpy",
        status: "paid",
        role: "affiliate",
      });
      await ctx.db.insert("settlementAllocations", {
        sourceChargeId: "ch_original",
        gross: 200,
        currency: "jpy",
        processingFee: 10,
        platformNet: 65,
        transfers: [
          { destinationAccountId: "acct_one", role: "affiliate", amount: 125 },
        ],
      });
    });
    const snapshot = () =>
      t.run(async (ctx) =>
        JSON.stringify({
          transfers: await ctx.db.query("transfers").take(10),
          allocations: await ctx.db.query("settlementAllocations").take(10),
        }),
      );
    const before = await snapshot();
    const registered = await t.mutation(register, physical);
    await t.run(async (ctx) => {
      await ctx.db.insert("accountClosures", {
        stripeAccountId: "acct_one",
        userId: "user_one",
        state: "closed",
        closedAt: 20,
      });
      const rows = await ctx.db.query("accounts").take(2);
      await ctx.db.delete("accounts", rows[0]!._id);
    });
    expect(await t.mutation(register, physical)).toEqual(registered);
    await expect(
      t.mutation(register, { ...physical, userId: "other" }),
    ).rejects.toThrow("immutable");
    expect(await snapshot()).toBe(before);
  });
  it("rejects corrupted generation rather than certifying a non-monotonic registration", async () => {
    const t = fixture();
    await t.run((ctx) =>
      ctx.db.insert("financialOwnershipGenerations", {
        userId: "user_one",
        generation: -1,
      }),
    );
    await expect(t.mutation(register, logical)).rejects.toThrow("generation");
    expect(
      await t.query(lookup, { bucketKey: logical.bucketKey }),
    ).toMatchObject({ status: "unknown", coverage: "unknown" });
  });

  it("concurrent matching logical registrations share one immutable receipt", async () => {
    const t = fixture();
    const [a, b] = await Promise.all([
      t.mutation(register, logical),
      t.mutation(register, logical),
    ]);
    expect(a).toEqual(b);
    expect(a.registration.generation).toBe(1);
    await expect(
      t.mutation(register, { ...physical, bucketKey: logical.bucketKey }),
    ).rejects.toThrow("immutable");
  });
  it.each(["", " leading", "trailing ", "x".repeat(257), "bad\u0000key"])(
    "rejects invalid selector %j without partial registration",
    async (bucketKey) => {
      const t = fixture();
      await expect(
        t.mutation(register, { ...logical, bucketKey }),
      ).rejects.toThrow();
      expect(
        await t.query(discover, {
          userId: logical.userId,
          paginationOpts: { numItems: 10, cursor: null },
        }),
      ).toMatchObject({ generation: 0, page: [] });
    },
  );
  it("does not accept a claimed coverage flag or missing logical source", async () => {
    const t = fixture();
    await expect(
      t.mutation(register, { ...logical, complete: true }),
    ).rejects.toThrow();
    await expect(
      t.mutation(register, { ...logical, source: undefined }),
    ).rejects.toThrow("source");
  });
  it("continues past100 owned buckets without leaking a foreign or organization record", async () => {
    const t = fixture();
    for (let i = 0; i < 103; i++)
      await t.mutation(register, { ...logical, bucketKey: `opaque_${i}` });
    await t.mutation(register, {
      ...logical,
      bucketKey: "foreign",
      userId: "user_other",
    });
    await t.mutation(register, {
      ...logical,
      bucketKey: "organization",
      orgId: "org_one",
    });
    let cursor: string | null = null;
    const keys: string[] = [];
    for (let page = 0; page < 10; page++) {
      const result: {
        coverage: string;
        generation: number;
        isDone: boolean;
        continueCursor: string;
        page: { bucketKey: string }[];
      } = await t.query(discover, {
        userId: logical.userId,
        paginationOpts: { numItems: 20, cursor },
      });
      expect(result.coverage).toBe("unknown");
      expect(result.generation).toBe(103);
      keys.push(
        ...result.page.map((row: { bucketKey: string }) => row.bucketKey),
      );
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(new Set(keys).size).toBe(103);
    expect(keys).not.toContain("foreign");
    expect(keys).not.toContain("organization");
    await expect(
      t.query(discover, {
        userId: logical.userId,
        paginationOpts: { numItems: 101, cursor: null },
      }),
    ).rejects.toThrow("page size");
  });
});
