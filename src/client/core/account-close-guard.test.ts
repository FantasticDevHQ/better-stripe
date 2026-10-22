// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { RunCtx } from "../helpers.js";
import { components, initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import { closeAccount } from "./accounts.js";
import type { AppliedConfiguration } from "../../component/core/validators.js";

const modules = import.meta.glob("../../component/**/*.ts");
async function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const component = components.betterStripe;
  await t.mutation(component.core.mutations.upsertAccount, {
    stripeAccountId: "acct_scope",
    userId: "original",
    appliedConfigurations: ["recipient"],
  });
  const close = vi.fn().mockResolvedValue({ id: "acct_scope", closed: true });
  const retrieve = vi.fn().mockResolvedValue({
    id: "acct_scope",
    closed: false,
    applied_configurations: ["merchant", "recipient"],
  });
  const stripe = {
    v2: { core: { accounts: { close, retrieve } } },
  } as unknown as Stripe;
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  return { t, component, ctx, stripe, close, retrieve };
}

it("refuses first guarded close when fresh provider roles differ from confirmed cached roles", async () => {
  const f = await fixture();
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
    }),
  ).rejects.toThrow();
  expect(f.retrieve).toHaveBeenCalledWith("acct_scope");
  expect(f.close).not.toHaveBeenCalled();
  expect(
    await f.t.query(f.component.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_scope",
    }),
  ).toMatchObject({ userId: "original" });
});

it("holds unknown provider scope rather than treating missing roles as an empty confirmed set", async () => {
  const f = await fixture();
  f.retrieve.mockResolvedValue({ id: "acct_scope", closed: false });
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
    }),
  ).rejects.toThrow();
  expect(f.close).not.toHaveBeenCalled();
});

it("reconciles observed terminal state with exact original ownership and scope without claiming a new POST", async () => {
  const f = await fixture();
  f.retrieve.mockResolvedValue({
    id: "acct_scope",
    closed: true,
    applied_configurations: [],
  });
  expect(
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
    }),
  ).toEqual({ closed: true });
  expect(f.close).not.toHaveBeenCalled();
});

it("reconciles the same original guarded lost ACK without another POST when closed roles are cleared", async () => {
  const f = await fixture();
  f.retrieve.mockResolvedValue({
    id: "acct_scope",
    closed: false,
    applied_configurations: ["recipient"],
  });
  f.close.mockRejectedValueOnce(new Error("Synthetic lost ACK"));
  const opts = {
    stripeAccountId: "acct_scope",
    expectedAppliedConfigurations: ["recipient" as const],
  };
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, opts),
  ).rejects.toThrow("Synthetic lost ACK");
  f.retrieve.mockResolvedValue({
    id: "acct_scope",
    closed: true,
    applied_configurations: [],
  });
  expect(await closeAccount(f.stripe, f.component, f.ctx, opts)).toEqual({
    closed: true,
  });
  expect(f.close).toHaveBeenCalledTimes(1);
  const history = await f.t.query(
    f.component.accountClosure.queries.getClosedAccountByStripeId,
    { stripeAccountId: "acct_scope" },
  );
  expect(history).toMatchObject({
    userId: "original",
    appliedConfigurations: ["recipient"],
  });
});

it("holds an unknown or foreign close acknowledgement without completing local history", async () => {
  const f = await fixture();
  f.retrieve.mockResolvedValue({
    id: "acct_scope",
    closed: false,
    applied_configurations: ["recipient"],
  });
  f.close.mockResolvedValue({ id: "acct_foreign", closed: true });
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
    }),
  ).rejects.toThrow();
  expect(
    await f.t.query(
      f.component.accountClosure.queries.getClosedAccountByStripeId,
      { stripeAccountId: "acct_scope" },
    ),
  ).toBeNull();
});

it.each<AppliedConfiguration[]>([
  [],
  ["customer"],
  ["merchant"],
  ["recipient"],
  ["customer", "merchant"],
  ["customer", "recipient"],
  ["merchant", "recipient"],
  ["customer", "merchant", "recipient"],
])(
  "freshly verifies and preserves each supported configuration set %j",
  async (...roles) => {
    const f = await fixture();
    await f.t.mutation(f.component.core.mutations.upsertAccount, {
      stripeAccountId: "acct_scope",
      userId: "original",
      appliedConfigurations: roles,
    });
    f.retrieve.mockResolvedValue({
      id: "acct_scope",
      closed: false,
      applied_configurations: [...roles].reverse(),
    });
    expect(
      await closeAccount(f.stripe, f.component, f.ctx, {
        stripeAccountId: "acct_scope",
        expectedAppliedConfigurations: roles,
      }),
    ).toEqual({ closed: true });
    expect(f.retrieve).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledWith(
      "acct_scope",
      { applied_configurations: roles },
      { idempotencyKey: "betterstripe-close:acct_scope" },
    );
  },
);

it.each([
  { id: "acct_foreign", closed: true, applied_configurations: [] },
  { id: "acct_scope", applied_configurations: ["recipient"] },
  {
    id: "acct_scope",
    closed: false,
    applied_configurations: ["recipient", "recipient"],
  },
  { id: "acct_scope", closed: false, applied_configurations: ["unsupported"] },
])("holds malformed/foreign current provider scope %j", async (provider) => {
  const f = await fixture();
  f.retrieve.mockResolvedValue(provider);
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
    }),
  ).rejects.toThrow();
  expect(f.close).not.toHaveBeenCalled();
});

it("does not expand an existing original pending scope after failed dispatch", async () => {
  const f = await fixture();
  f.retrieve.mockResolvedValue({
    id: "acct_scope",
    closed: false,
    applied_configurations: ["recipient"],
  });
  f.close.mockRejectedValueOnce(new Error("Synthetic unknown response"));
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
    }),
  ).rejects.toThrow();
  f.retrieve.mockResolvedValue({
    id: "acct_scope",
    closed: true,
    applied_configurations: [],
  });
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["merchant", "recipient"],
    }),
  ).rejects.toThrow();
  expect(f.close).toHaveBeenCalledTimes(1);
});

it("holds absent original scope even when the same provider account is already closed", async () => {
  const f = await fixture();
  await f.t.mutation(f.component.core.mutations.upsertAccount, {
    stripeAccountId: "acct_unknown",
    userId: "original",
  });
  f.retrieve.mockResolvedValue({
    id: "acct_unknown",
    closed: true,
    applied_configurations: [],
  });
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_unknown",
      expectedAppliedConfigurations: [],
    }),
  ).rejects.toThrow();
  expect(f.close).not.toHaveBeenCalled();
});

it("reconciles observed closed state after a pre-dispatch crash without attributing provider causality", async () => {
  const f = await fixture();
  await f.t.mutation(f.component.accountClosure.mutations.prepare, {
    stripeAccountId: "acct_scope",
  });
  f.retrieve.mockResolvedValue({
    id: "acct_scope",
    closed: true,
    applied_configurations: [],
  });
  expect(
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
    }),
  ).toEqual({ closed: true });
  expect(f.close).not.toHaveBeenCalled();
});

it("holds removal of the current original mapping while the fresh provider read is suspended", async () => {
  const f = await fixture();
  f.retrieve.mockImplementationOnce(async () => {
    await expect(
      f.t.mutation(f.component.core.mutations.upsertAccount, {
        stripeAccountId: "acct_scope",
        userId: "replacement",
        appliedConfigurations: ["recipient"],
      }),
    ).rejects.toThrow("ownership is pinned");
    expect(
      await f.t.mutation(f.component.core.mutations.deleteAccountByStripeId, {
        stripeAccountId: "acct_scope",
      }),
    ).toBe(true);
    return {
      id: "acct_scope",
      closed: false,
      applied_configurations: ["recipient"],
    };
  });
  let failure: unknown;
  try {
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
    });
  } catch (error) {
    failure = error;
  }
  expect(f.close).not.toHaveBeenCalled();
  expect(failure).toBeDefined();
  expect(
    await f.t.query(
      f.component.accountClosure.queries.getClosedAccountByStripeId,
      { stripeAccountId: "acct_scope" },
    ),
  ).toBeNull();
});

it("preserves known original history from terminal observation even when the live mapping was removed", async () => {
  const f = await fixture();
  f.retrieve.mockImplementationOnce(async () => {
    await f.t.mutation(f.component.core.mutations.deleteAccountByStripeId, {
      stripeAccountId: "acct_scope",
    });
    return { id: "acct_scope", closed: true, applied_configurations: [] };
  });
  expect(
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
    }),
  ).toEqual({ closed: true });
  expect(f.close).not.toHaveBeenCalled();
  expect(
    await f.t.query(
      f.component.accountClosure.queries.getClosedAccountByStripeId,
      { stripeAccountId: "acct_scope" },
    ),
  ).toMatchObject({ userId: "original", appliedConfigurations: ["recipient"] });
});

it("preserves the existing unguarded closed-argument validator for unsupported runtime keys", async () => {
  const f = await fixture();
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      ...{ unsupportedCloseMode: true },
    }),
  ).rejects.toThrow();
  expect(f.close).not.toHaveBeenCalled();
});

it("validates guarded inputs before consuming an original pending request", async () => {
  const f = await fixture();
  await expect(
    closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_scope",
      expectedAppliedConfigurations: ["recipient"],
      ...{ unsupportedCloseMode: true },
    }),
  ).rejects.toThrow();
  expect(f.close).not.toHaveBeenCalled();
  const original = await f.t.mutation(
    f.component.accountClosure.mutations.prepare,
    { stripeAccountId: "acct_scope" },
  );
  expect(original.isRetry).toBe(false);
});
