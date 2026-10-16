// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

describe("core — account mutations and queries", () => {
  it("upsertAccount: inserts new account", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_001",
      userId: "user_001",
      name: "Test Account",
      email: "test@example.com",
    });

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: "user_001",
    });

    expect(account).not.toBeNull();
    expect(account!.stripeAccountId).toBe("acct_001");
    expect(account!.userId).toBe("user_001");
    expect(account!.name).toBe("Test Account");
    expect(account!.onboardingStatus).toBe("pending");
  });

  it("upsertAccount: updates existing account by stripeAccountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_002",
      userId: "user_002",
      name: "Original Name",
    });

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_002",
      userId: "user_002",
      name: "Updated Name",
    });

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: "user_002",
    });

    expect(account).not.toBeNull();
    expect(account!.name).toBe("Updated Name");
  });

  it("getAccountByUserId: returns matching account", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_003",
      userId: "user_003",
      email: "found@example.com",
    });

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: "user_003",
    });

    expect(account).not.toBeNull();
    expect(account!.userId).toBe("user_003");
    expect(account!.email).toBe("found@example.com");
  });

  it("getAccountByUserId: returns null for unknown user", async () => {
    const t = convexTest(schema, modules);

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: "user_nonexistent",
    });

    expect(account).toBeNull();
  });

  it("getAccountOnboardingStatus reflects missingRequirements and readiness", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_004",
      userId: "user_004",
      onboardingStatus: "complete",
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_004",
    });

    const status = await t.query(api.core.queries.getAccountOnboardingStatus, {
      accountId: account!._id,
    });

    expect(status).not.toBeNull();
    expect(status!.isReady).toBe(true);
    expect(status!.onboardingStatus).toBe("complete");
    expect(status!.missingRequirements).toEqual([]);
  });
});

describe("core — getAccountByOrgId", () => {
  it("returns account matching orgId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_org_001",
      userId: "user_org_001",
      orgId: "org_001",
      name: "Org Account",
    });

    const account = await t.query(api.core.queries.getAccountByOrgId, {
      orgId: "org_001",
    });

    expect(account).not.toBeNull();
    expect(account!.orgId).toBe("org_001");
    expect(account!.stripeAccountId).toBe("acct_org_001");
  });

  it("returns null for unknown orgId", async () => {
    const t = convexTest(schema, modules);

    const account = await t.query(api.core.queries.getAccountByOrgId, {
      orgId: "org_nonexistent",
    });

    expect(account).toBeNull();
  });
});

describe("core — deleteAccountByStripeId", () => {
  it("deletes existing account and returns true", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_del_001",
      userId: "user_del_001",
    });

    const result = await t.mutation(
      api.core.mutations.deleteAccountByStripeId,
      {
        stripeAccountId: "acct_del_001",
      },
    );

    expect(result).toBe(true);

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_del_001",
    });
    expect(account).toBeNull();
  });

  it("returns false for nonexistent account", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(
      api.core.mutations.deleteAccountByStripeId,
      {
        stripeAccountId: "acct_nonexistent",
      },
    );

    expect(result).toBe(false);
  });
});

describe("core — upsertAccountInternal", () => {
  it("inserts account with required onboardingStatus", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccountInternal, {
      stripeAccountId: "acct_int_001",
      userId: "user_int_001",
      onboardingStatus: "in_progress",
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_int_001",
    });

    expect(account).not.toBeNull();
    expect(account!.onboardingStatus).toBe("in_progress");
  });

  it("updates existing account onboardingStatus", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccountInternal, {
      stripeAccountId: "acct_int_002",
      userId: "user_int_002",
      onboardingStatus: "pending",
    });

    await t.mutation(api.core.mutations.upsertAccountInternal, {
      stripeAccountId: "acct_int_002",
      userId: "user_int_002",
      onboardingStatus: "complete",
      missingRequirements: [],
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_int_002",
    });

    expect(account!.onboardingStatus).toBe("complete");
    expect(account!.missingRequirements).toEqual([]);
  });
});

describe("core — onboarding status edge cases", () => {
  it("getAccountOnboardingStatus returns null for nonexistent account", async () => {
    const t = convexTest(schema, modules);

    // Insert then delete to get a valid but missing ID
    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_ghost",
      userId: "user_ghost",
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_ghost",
    });

    await t.mutation(api.core.mutations.deleteAccountByStripeId, {
      stripeAccountId: "acct_ghost",
    });

    const status = await t.query(api.core.queries.getAccountOnboardingStatus, {
      accountId: account!._id,
    });

    expect(status).toBeNull();
  });

  it("incomplete account has isReady false and missingRequirements", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccountInternal, {
      stripeAccountId: "acct_incomplete",
      userId: "user_incomplete",
      onboardingStatus: "restricted",
      missingRequirements: ["external_account", "tos_acceptance"],
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_incomplete",
    });

    const status = await t.query(api.core.queries.getAccountOnboardingStatus, {
      accountId: account!._id,
    });

    expect(status!.isReady).toBe(false);
    expect(status!.onboardingStatus).toBe("restricted");
    expect(status!.missingRequirements).toEqual([
      "external_account",
      "tos_acceptance",
    ]);
  });
});
