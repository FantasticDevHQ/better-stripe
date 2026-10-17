// @vitest-environment edge-runtime
import { anyApi } from "convex/server";
import { expect, it, vi } from "vitest";
import {
  nested,
  scope,
  stripeSubscriptionId,
  original,
  setup,
  fixture,
} from "./workflow.fixtures.js";
import { STRIPE_CUSTOMER_PREVIEW_API_VERSION as version } from "../../client/apiVersion.js";
it("persists original restoration before nested workflow provisioning and finishes only from verified receipts", async () => {
  const t = setup();
  const started = await t.action(anyApi.host.prepare, {
    requestKey: "prepare-once",
  });
  expect(started.status).toBe("accepted");
  expect(started.workflowId).toEqual(expect.any(String));
  const lookup = {
    ...scope,
    stripeSubscriptionId,
    providerApiVersion: version,
  };
  const before = await t.query(
    nested.betterStripe.balanceFunding.queries.readScopePreparation,
    lookup,
  );
  expect(before).toMatchObject({
    preparation: original,
    verified: false,
    consentReference: "original-consent",
    activeOperationId: started.operation.operationId,
  });
  expect(fixture.requests.every((r) => r.method === "GET")).toBe(true);
  const operation = await t.query(
    nested.betterStripe.balanceFunding.queries.inspectOperation,
    { ...started.operation, stripeSubscriptionId },
  );
  expect(operation.providerKeys.create).toEqual(expect.any(String));
  expect(operation.providerKeys.attach).toEqual(expect.any(String));
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.balanceFunding.queries.getPreparation, {
      ...started.operation,
      stripeSubscriptionId,
    }),
  ).toMatchObject({
    status: "prepared",
    operation: started.operation,
    preparationId: before._id,
  });
  const after = await t.query(
    nested.betterStripe.balanceFunding.queries.readScopePreparation,
    lookup,
  );
  expect(after.preparation).toEqual({
    ...original,
    paymentMethodId: "pm_balance",
  });
  expect(after.verified).toBe(true);
  const writes = fixture.requests.filter((r) => r.method === "POST");
  expect(writes).toEqual([
    {
      method: "POST",
      path: "/v1/payment_methods",
      version,
      key: operation.providerKeys.create,
    },
    {
      method: "POST",
      path: "/v1/payment_methods/pm_balance/attach",
      version,
      key: operation.providerKeys.attach,
    },
  ]);
  expect(fixture.requests.every((r) => r.version === version)).toBe(true);
});

it("joins duplicate public fixture.requests without recapturing settings or creating another workflow", async () => {
  const t = setup();
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "prepare-once",
  });
  const reads = fixture.requests.length;
  expect(
    await t.action(anyApi.host.prepare, { requestKey: "prepare-once" }),
  ).toEqual(first);
  expect(fixture.requests).toHaveLength(reads);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    fixture.requests.filter(
      (r) => r.method === "POST" && r.path === "/v1/payment_methods",
    ),
  ).toHaveLength(1);
});

it("holds a lost create ID across resume and cancellation without reissuing the effect", async () => {
  fixture.unknownPhase = "create";
  const t = setup();
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "lost-create",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const ref = { ...first.operation, stripeSubscriptionId };
  expect(
    await t.query(
      nested.betterStripe.balanceFunding.queries.getPreparation,
      ref,
    ),
  ).toMatchObject({ status: "unknown" });
  const control = {
    operationId: first.operation.operationId,
    version: first.operation.version,
  };
  await t.action(anyApi.host.resume, control);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.action(anyApi.host.cancel, control);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const saved = await t.query(
    nested.betterStripe.balanceFunding.queries.readScopePreparation,
    { ...scope, stripeSubscriptionId, providerApiVersion: version },
  );
  expect(saved).toMatchObject({
    preparation: original,
    verified: false,
    activeOperationId: first.operation.operationId,
  });
  expect(
    fixture.requests.filter(
      (r) => r.method === "POST" && r.path === "/v1/payment_methods",
    ),
  ).toHaveLength(1);
  const history = await t.query(
    nested.betterStripe.fundingWorkflowFixture.history,
    { id: first.workflowId },
  );
  expect(JSON.stringify(history)).not.toContain("raw_provider_private_failure");
});

it("reconciles a lost attachment response by known-ID readback without another attach", async () => {
  fixture.unknownPhase = "attach";
  const t = setup();
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "lost-attach",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const ref = { ...first.operation, stripeSubscriptionId };
  expect(
    await t.query(
      nested.betterStripe.balanceFunding.queries.getPreparation,
      ref,
    ),
  ).toMatchObject({ status: "unknown" });
  await t.action(anyApi.host.resume, {
    operationId: first.operation.operationId,
    version: first.operation.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(
      nested.betterStripe.balanceFunding.queries.getPreparation,
      ref,
    ),
  ).toMatchObject({ status: "prepared" });
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(2);
  expect(
    fixture.requests.filter(
      (r) => r.path.endsWith("/attach") && r.method === "POST",
    ),
  ).toHaveLength(1);
});

it("allowlists host receipts before they reach the durable workflow journal", async () => {
  fixture.extraFields = true;
  const t = setup();
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "sanitized",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.balanceFunding.queries.getPreparation, {
      ...first.operation,
      stripeSubscriptionId,
    }),
  ).toMatchObject({ status: "prepared" });
  const history = await t.query(
    nested.betterStripe.fundingWorkflowFixture.history,
    { id: first.workflowId },
  );
  expect(JSON.stringify(history)).not.toContain("raw_provider_private_field");
});

it("resumes a failed database finish from retained receipts without replaying provider writes", async () => {
  const t = setup(true);
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "finish-retry",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.fundingWorkflowFixture.status, {
      id: first.workflowId,
    }),
  ).toMatchObject({ type: "failed" });
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(2);
  await t.action(anyApi.host.resume, {
    operationId: first.operation.operationId,
    version: first.operation.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.balanceFunding.queries.getPreparation, {
      ...first.operation,
      stripeSubscriptionId,
    }),
  ).toMatchObject({ status: "prepared" });
  expect(
    await t.query(nested.betterStripe.fundingWorkflowFixture.status, {
      id: first.workflowId,
    }),
  ).toMatchObject({ type: "completed" });
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(2);
});

it("enables and restores the exact original settings using separate durable operation versions", async () => {
  const t = setup();
  const prepared = await t.action(anyApi.host.prepare, {
    requestKey: "apply-prepare",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const saved = await t.query(
    nested.betterStripe.balanceFunding.queries.getPreparation,
    { ...prepared.operation, stripeSubscriptionId },
  );
  const first = await t.action(anyApi.host.apply, {
    preparationId: saved.preparationId,
    enabled: true,
    requestKey: "enable",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fixture.enabled).toBe(true);
  expect(
    await t.query(nested.betterStripe.balanceFunding.queries.getOperation, {
      ...first.operation,
      stripeSubscriptionId,
    }),
  ).toMatchObject({ state: "succeeded" });
  const second = await t.action(anyApi.host.apply, {
    preparationId: saved.preparationId,
    enabled: false,
    requestKey: "disable",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fixture.enabled).toBe(false);
  expect(second.operation.version).toBeGreaterThan(first.operation.version);
  expect(
    fixture.requests
      .filter((r) => r.path.includes("subscriptions") && r.method === "POST")
      .map((r) => r.key),
  ).toEqual([
    expect.stringContaining(":enable"),
    expect.stringContaining(":disable"),
  ]);
});
it("reconciles an unknown apply by readback without another provider update", async () => {
  const t = setup();
  const prepared = await t.action(anyApi.host.prepare, {
    requestKey: "unknown-apply-prepare",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const saved = await t.query(
    nested.betterStripe.balanceFunding.queries.getPreparation,
    { ...prepared.operation, stripeSubscriptionId },
  );
  fixture.lostApply = true;
  const first = await t.action(anyApi.host.apply, {
    preparationId: saved.preparationId,
    enabled: true,
    requestKey: "unknown-enable",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.balanceFunding.queries.getOperation, {
      ...first.operation,
      stripeSubscriptionId,
    }),
  ).toMatchObject({ state: "unknown" });
  await t.action(anyApi.host.resume, {
    operationId: first.operation.operationId,
    version: first.operation.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.balanceFunding.queries.getOperation, {
      ...first.operation,
      stripeSubscriptionId,
    }),
  ).toMatchObject({ state: "succeeded" });
  expect(
    fixture.requests.filter(
      (r) => r.path.includes("subscriptions") && r.method === "POST",
    ),
  ).toHaveLength(1);
});

it("holds in-flight cancellation without releasing original restoration or starting an attach", async () => {
  const t = setup();
  fixture.cancelPhase = "create";
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "cancel-inflight",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.action(anyApi.host.inspect, {
      operationId: first.operation.operationId,
      version: first.operation.version,
    }),
  ).toMatchObject({ state: "unknown", cancelRequested: true });
  await t.action(anyApi.host.resume, {
    operationId: first.operation.operationId,
    version: first.operation.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  const saved = await t.query(
    nested.betterStripe.balanceFunding.queries.readScopePreparation,
    { ...scope, stripeSubscriptionId, providerApiVersion: version },
  );
  expect(saved).toMatchObject({
    preparation: original,
    verified: false,
    activeOperationId: first.operation.operationId,
  });
});
it("finishes from a retained positive attachment receipt after cancellation races its response", async () => {
  const t = setup();
  fixture.cancelPhase = "attach";
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "cancel-after-attach",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.action(anyApi.host.resume, {
    operationId: first.operation.operationId,
    version: first.operation.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.balanceFunding.queries.getPreparation, {
      ...first.operation,
      stripeSubscriptionId,
    }),
  ).toMatchObject({ status: "prepared" });
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(2);
});
it("rejects changed definition and stale version before provider replay", async () => {
  const t = setup();
  fixture.unknownPhase = "create";
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "changed-definition",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const args = {
    ...first.operation,
    stripeSubscriptionId,
    providerApiVersion: version,
    definitionVersion: "balance-funding/v2",
  };
  expect(
    await t.mutation(
      nested.betterStripe.balanceFunding.mutations.resumeWorkflow,
      args,
    ),
  ).toMatchObject({ status: "conflict", reason: "revision_changed" });
  expect(
    await t.mutation(
      nested.betterStripe.balanceFunding.mutations.resumeWorkflow,
      {
        ...args,
        definitionVersion: "balance-funding/v1",
        version: first.operation.version + 1,
      },
    ),
  ).toMatchObject({ status: "conflict" });
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(1);
});
it("keeps an unknown effect held after workflow retention is cleaned", async () => {
  const t = setup();
  fixture.unknownPhase = "create";
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "expired-history",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.mutation(nested.betterStripe.fundingWorkflowFixture.cleanup, {
    id: first.workflowId,
  });
  expect(
    await t.action(anyApi.host.resume, {
      operationId: first.operation.operationId,
      version: first.operation.version,
    }),
  ).toMatchObject({
    status: "unknown",
    reason: "history_incomplete",
    retryable: false,
  });
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(1);
});

it("rolls back a failed workflow start so retry can bind the persisted intent", async () => {
  const { executionWorkflow } = await import("../durableExecution/runtime.js");
  const start = vi
    .spyOn(executionWorkflow, "start")
    .mockRejectedValueOnce(new Error("controlled scheduling failure"));
  const t = setup();
  try {
    await expect(
      t.action(anyApi.host.prepare, { requestKey: "failed-start" }),
    ).rejects.toThrow();
    const saved = await t.query(
      nested.betterStripe.balanceFunding.queries.readScopePreparation,
      { ...scope, stripeSubscriptionId, providerApiVersion: version },
    );
    const prior = await t.query(
      nested.betterStripe.balanceFunding.queries.inspectOperation,
      {
        ...scope,
        operationId: saved.activeOperationId,
        version: saved.operationVersion,
        stripeSubscriptionId,
      },
    );
    expect(prior.execution).toBeUndefined();
    const reads = fixture.requests.length;
    const retried = await t.action(anyApi.host.prepare, {
      requestKey: "failed-start",
    });
    expect(retried.workflowId).toEqual(expect.any(String));
    expect(fixture.requests).toHaveLength(reads);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await t.query(nested.betterStripe.balanceFunding.queries.getPreparation, {
        ...retried.operation,
        stripeSubscriptionId,
      }),
    ).toMatchObject({ status: "prepared" });
  } finally {
    start.mockRestore();
  }
});

it("resumes a paused pre-dispatch phase after unpause without inventing an unknown provider effect", async () => {
  const t = setup();
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "paused-before-create",
  });
  const saved = await t.query(
    nested.betterStripe.balanceFunding.queries.readScopePreparation,
    { ...scope, stripeSubscriptionId, providerApiVersion: version },
  );
  const control = { ...scope, stripeSubscriptionId, preparationId: saved._id };
  await t.mutation(
    nested.betterStripe.balanceFunding.mutations.setStartsPaused,
    { ...control, paused: true },
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  const blocked = await t.query(
    nested.betterStripe.balanceFunding.queries.inspectOperation,
    { ...first.operation, stripeSubscriptionId },
  );
  expect(blocked.execution.create).toBeUndefined();
  await t.mutation(
    nested.betterStripe.balanceFunding.mutations.setStartsPaused,
    { ...control, paused: false },
  );
  await t.action(anyApi.host.resume, {
    operationId: first.operation.operationId,
    version: first.operation.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.balanceFunding.queries.getPreparation, {
      ...first.operation,
      stripeSubscriptionId,
    }),
  ).toMatchObject({ status: "prepared" });
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(2);
});

it("recovers a positive journal receipt when cancellation races a failed receipt write", async () => {
  const t = setup(false, true);
  const first = await t.action(anyApi.host.prepare, {
    requestKey: "cancel-receipt-store-outage",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.action(anyApi.host.cancel, {
    operationId: first.operation.operationId,
    version: first.operation.version,
  });
  await t.action(anyApi.host.resume, {
    operationId: first.operation.operationId,
    version: first.operation.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.balanceFunding.queries.getPreparation, {
      ...first.operation,
      stripeSubscriptionId,
    }),
  ).toMatchObject({ status: "prepared" });
  expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(2);
});

it("finishes apply from a restored positive journal when no record step was scheduled", async () => {
  const t = setup(false, true, true);
  const prepared = await t.action(anyApi.host.prepare, {
    requestKey: "checkpoint-prepare",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const saved = await t.query(
    nested.betterStripe.balanceFunding.queries.getPreparation,
    { ...prepared.operation, stripeSubscriptionId },
  );
  fixture.checkpointFault = true;
  const applied = await t.action(anyApi.host.apply, {
    preparationId: saved.preparationId,
    enabled: true,
    requestKey: "checkpoint-enable",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.action(anyApi.host.cancel, {
    operationId: applied.operation.operationId,
    version: applied.operation.version,
  });
  expect(
    await t.action(anyApi.host.resume, {
      operationId: applied.operation.operationId,
      version: applied.operation.version,
    }),
  ).toMatchObject({ status: "accepted" });
  expect(
    await t.action(anyApi.host.inspect, {
      operationId: applied.operation.operationId,
      version: applied.operation.version,
    }),
  ).toMatchObject({ state: "succeeded" });
  expect(
    fixture.requests.filter(
      (r) => r.path.includes("subscriptions") && r.method === "POST",
    ),
  ).toHaveLength(1);
});
