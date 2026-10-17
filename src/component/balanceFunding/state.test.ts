// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
const m = (name: string) =>
  makeFunctionReference<"mutation">(`balanceFunding/mutations:${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`balanceFunding/queries:${name}`);
const scope = { accountId: "acct_owner", scopeKey: "opaque-owner-scope" };
const snapshot = {
  customerAccount: scope.accountId,
  stripeSubscriptionId: "sub_plan",
  paymentMethodId: "pm_balance",
  previousPaymentMethodId: "pm_original",
  previousPaymentMethodTypes: ["card"],
};
const preparation = {
  ...scope,
  preparation: snapshot,
  consentAt: 100,
  consentReference: "consent-record-1",
  providerApiVersion: "2026-06-30.preview",
};
it("persists original restoration and consent once, and rejects replacement", async () => {
  const t = convexTest(schema, modules);
  const saved = await t.mutation(m("savePreparation"), preparation);
  expect(saved.preparationId).toEqual(expect.any(String));
  expect(await t.mutation(m("savePreparation"), preparation)).toEqual(saved);
  const read = await t.query(q("readPreparation"), {
    ...{
      ...scope,
      preparationId: saved.preparationId,
    },
    stripeSubscriptionId: "sub_plan",
  });
  expect(read.preparation).toEqual(snapshot);
  expect(read.consentReference).toBe(preparation.consentReference);
  expect(read.enabled).toBe(false);
  await expect(
    t.mutation(m("savePreparation"), {
      ...preparation,
      preparation: { ...snapshot, previousPaymentMethodId: "pm_changed" },
    }),
  ).rejects.toThrow(/identity|restoration|conflict/i);
});
it("reuses the same pending and completed request without changing restoration", async () => {
  const t = convexTest(schema, modules);
  const saved = await t.mutation(m("savePreparation"), preparation);
  const args = {
    ...scope,
    preparationId: saved.preparationId,
    enabled: true,
    consent: true,
    requestKey: "enable-request",
  };
  const first = await t.mutation(m("begin"), args);
  expect(first.status).toBe("accepted");
  expect(first.operation.version).toBe(1);
  expect(await t.mutation(m("begin"), args)).toEqual(first);
  const active = await t.query(q("inspectOperation"), {
    ...first.operation,
    stripeSubscriptionId: "sub_plan",
  });
  expect(active.state).toBe("pending");
  expect(active.providerKeys.enable).toEqual(expect.any(String));
  const receipt = {
    customerAccount: scope.accountId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    paymentMethodId: snapshot.paymentMethodId,
    paymentMethodTypes: ["stripe_balance"],
    providerApiVersion: preparation.providerApiVersion,
  };
  await t.mutation(m("finish"), { ...first.operation, enabled: true, receipt });
  expect(await t.mutation(m("begin"), args)).toEqual(first);
  const status = await t.query(q("inspectOperation"), {
    ...first.operation,
    stripeSubscriptionId: "sub_plan",
  });
  expect(status.state).toBe("succeeded");
  expect(status.providerKeys).toEqual(active.providerKeys);
  expect(
    (
      await t.query(q("readPreparation"), {
        ...{
          ...scope,
          preparationId: saved.preparationId,
        },
        stripeSubscriptionId: "sub_plan",
      })
    ).preparation,
  ).toEqual(snapshot);
});
it("holds the account/subscription boundary against opposing targets and aliases", async () => {
  const t = convexTest(schema, modules);
  const saved = await t.mutation(m("savePreparation"), preparation);
  const args = {
    ...scope,
    preparationId: saved.preparationId,
    enabled: true,
    consent: true,
    requestKey: "enable",
  };
  await t.mutation(m("begin"), args);
  expect(
    await t.mutation(m("begin"), {
      ...args,
      enabled: false,
      requestKey: "disable",
    }),
  ).toEqual({ status: "conflict", reason: "scope_busy", retryable: false });
  await expect(
    t.mutation(m("savePreparation"), { ...preparation, scopeKey: "alias" }),
  ).rejects.toThrow(/scope|identity|conflict/i);
  expect(
    await t.mutation(m("begin"), {
      ...args,
      scopeKey: "alias",
      requestKey: "alias-enable",
    }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
});
it("keeps request payload immutable and rejects enable without consent", async () => {
  const t = convexTest(schema, modules);
  const saved = await t.mutation(m("savePreparation"), preparation);
  const args = {
    ...scope,
    preparationId: saved.preparationId,
    enabled: true,
    requestKey: "enable",
  };
  expect(await t.mutation(m("begin"), args)).toEqual({
    status: "rejected",
    reason: "policy_invalid",
    retryable: false,
  });
  const first = await t.mutation(m("begin"), { ...args, consent: true });
  expect(first.status).toBe("accepted");
  expect(await t.mutation(m("begin"), { ...args, enabled: false })).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
  expect(
    await t.mutation(m("begin"), {
      ...args,
      consent: true,
      accountId: "foreign",
    }),
  ).toEqual({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  });
  await expect(
    t.query(q("inspectOperation"), {
      ...{ ...first.operation, scopeKey: "foreign" },
      stripeSubscriptionId: "sub_plan",
    }),
  ).rejects.toThrow(/identity/i);
});
it("refuses stale completion and foreign receipts while preserving null versus empty settings", async () => {
  const t = convexTest(schema, modules);
  const prep = {
    ...preparation,
    preparation: {
      ...snapshot,
      previousPaymentMethodId: null,
      previousPaymentMethodTypes: [],
    },
  };
  const saved = await t.mutation(m("savePreparation"), prep);
  const begin = (enabled: boolean, requestKey: string) =>
    t.mutation(m("begin"), {
      ...scope,
      preparationId: saved.preparationId,
      enabled,
      consent: true,
      requestKey,
    });
  const first = await begin(true, "on");
  const receipt = {
    customerAccount: scope.accountId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    paymentMethodId: snapshot.paymentMethodId,
    paymentMethodTypes: ["stripe_balance"],
    providerApiVersion: preparation.providerApiVersion,
  };
  await expect(
    t.mutation(m("finish"), {
      ...first.operation,
      enabled: true,
      receipt: { ...receipt, customerAccount: "foreign" },
    }),
  ).rejects.toThrow(/receipt/i);
  await t.mutation(m("finish"), { ...first.operation, enabled: true, receipt });
  const off = await begin(false, "off");
  expect(off.operation.version).toBe(2);
  await expect(
    t.mutation(m("finish"), {
      ...off.operation,
      version: 1,
      enabled: false,
      receipt,
    }),
  ).rejects.toThrow(/identity/i);
  await expect(
    t.mutation(m("finish"), {
      ...off.operation,
      enabled: false,
      receipt: { ...receipt, paymentMethodId: null, paymentMethodTypes: null },
    }),
  ).rejects.toThrow(/receipt/i);
  await t.mutation(m("finish"), {
    ...off.operation,
    enabled: false,
    receipt: { ...receipt, paymentMethodId: null, paymentMethodTypes: [] },
  });
  await t.mutation(m("finish"), { ...first.operation, enabled: true, receipt });
  expect(
    (
      await t.query(q("readPreparation"), {
        ...{
          ...scope,
          preparationId: saved.preparationId,
        },
        stripeSubscriptionId: "sub_plan",
      })
    ).enabled,
  ).toBe(false);
});
it("cancels unstarted work and retains running or unknown scope claims until receipts reconcile", async () => {
  const t = convexTest(schema, modules);
  const saved = await t.mutation(m("savePreparation"), preparation);
  const args = {
    ...scope,
    preparationId: saved.preparationId,
    enabled: true,
    consent: true,
    requestKey: "cancel-before-start",
  };
  const first = await t.mutation(m("begin"), args);
  const canceled = await t.mutation(m("requestCancel"), first.operation);
  expect(canceled.state).toBe("canceled");
  expect((await t.mutation(m("start"), first.operation)).state).toBe(
    "canceled",
  );
  const second = await t.mutation(m("begin"), {
    ...args,
    requestKey: "running",
  });
  expect(second.operation.version).toBe(2);
  expect((await t.mutation(m("start"), second.operation)).state).toBe(
    "running",
  );
  expect((await t.mutation(m("requestCancel"), second.operation)).state).toBe(
    "running",
  );
  expect((await t.mutation(m("markUnknown"), second.operation)).state).toBe(
    "unknown",
  );
  expect(
    await t.mutation(m("begin"), {
      ...args,
      enabled: false,
      requestKey: "opposite",
    }),
  ).toEqual({ status: "conflict", reason: "scope_busy", retryable: false });
  await t.mutation(m("finish"), {
    ...second.operation,
    enabled: true,
    receipt: {
      customerAccount: scope.accountId,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      paymentMethodId: snapshot.paymentMethodId,
      paymentMethodTypes: ["stripe_balance"],
      providerApiVersion: preparation.providerApiVersion,
    },
  });
  const done = await t.query(q("inspectOperation"), {
    ...second.operation,
    stripeSubscriptionId: "sub_plan",
  });
  expect(done.state).toBe("succeeded");
  expect(done.cancelRequested).toBe(true);
});
it("pauses new starts while allowing original receipt reconciliation", async () => {
  const t = convexTest(schema, modules);
  const saved = await t.mutation(m("savePreparation"), preparation);
  const args = {
    ...scope,
    preparationId: saved.preparationId,
    enabled: true,
    consent: true,
    requestKey: "on",
  };
  const first = await t.mutation(m("begin"), args);
  const binding = {
    ...scope,
    preparationId: saved.preparationId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
  };
  await t.mutation(m("setStartsPaused"), { ...binding, paused: true });
  await expect(t.mutation(m("start"), first.operation)).rejects.toThrow(
    /paused/i,
  );
  expect(await t.mutation(m("begin"), { ...args, requestKey: "new" })).toEqual({
    status: "conflict",
    reason: "scope_busy",
    retryable: false,
  });
  await t.mutation(m("finish"), {
    ...first.operation,
    enabled: true,
    receipt: {
      customerAccount: scope.accountId,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      paymentMethodId: snapshot.paymentMethodId,
      paymentMethodTypes: ["stripe_balance"],
      providerApiVersion: preparation.providerApiVersion,
    },
  });
  expect(await t.mutation(m("begin"), args)).toEqual(first);
  expect(
    await t.mutation(m("begin"), {
      ...args,
      enabled: false,
      requestKey: "off",
    }),
  ).toEqual({ status: "conflict", reason: "scope_busy", retryable: false });
  await t.mutation(m("setStartsPaused"), { ...binding, paused: false });
  expect(
    (
      await t.mutation(m("begin"), {
        ...args,
        enabled: false,
        requestKey: "off",
      })
    ).status,
  ).toBe("accepted");
  await expect(
    t.mutation(m("setStartsPaused"), {
      ...binding,
      stripeSubscriptionId: "foreign",
      paused: true,
    }),
  ).rejects.toThrow(/identity/i);
});
