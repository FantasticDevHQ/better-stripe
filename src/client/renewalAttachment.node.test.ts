import { afterEach, expect, it, vi } from "vitest";
import { attachmentFixture } from "./renewalAttachmentTestHelpers.js";
import { components } from "../../example/convex/_generated/api.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("attaches once through the public Node client and retains a readable acknowledgement", async () => {
  await attachmentFixture(async ({ client, ctx, options, calls }) => {
    const result = await client.attachRenewalSchedule(ctx, options);
    expect(result.status).toBe("attached_incomplete");
    const writes = calls.filter((row) => row.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      path: "/v1/subscription_schedules",
      key: "attach:retained315",
      body: "from_subscription=sub_original",
    });
    const acknowledgement = await ctx.runQuery(
      components.betterStripe.renewalOperations.queries
        .readProviderAcknowledgement,
      { operationId: options.operationId },
    );
    expect(acknowledgement).not.toBeNull();
    const duplicate = await client.attachRenewalSchedule(ctx, options);
    expect(duplicate.status).toBe("conflict");
    expect(calls.filter((row) => row.method === "POST")).toHaveLength(1);
  });
});

it("refuses revoked host authorization before any provider request", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      expect(await client.attachRenewalSchedule(ctx, options)).toMatchObject({
        status: "not_dispatched",
        reason: "not_authorized",
      });
      expect(calls).toEqual([]);
    },
    { authorize: false },
  );
});

it("refuses a foreign request binding before any provider request", async () => {
  await attachmentFixture(async ({ client, ctx, options, calls }) => {
    expect(
      await client.attachRenewalSchedule(ctx, {
        ...options,
        requestBinding: "foreign",
      }),
    ).toMatchObject({ status: "conflict", reason: "request_binding_mismatch" });
    expect(calls).toEqual([]);
  });
});

it("returns unknown after a lost response without retrying or allowing another dispatch", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      const result = await client.attachRenewalSchedule(ctx, options);
      expect(result.status).toBe("unknown");
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(1);
      expect((await client.attachRenewalSchedule(ctx, options)).status).toBe(
        "conflict",
      );
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(1);
      const acknowledgement = await ctx.runQuery(
        components.betterStripe.renewalOperations.queries
          .readProviderAcknowledgement,
        { operationId: options.operationId },
      );
      expect(acknowledgement).toBeNull();
    },
    { post: "lost" },
  );
});

it("returns a provider conflict without retrying", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      expect(await client.attachRenewalSchedule(ctx, options)).toMatchObject({
        status: "conflict",
        reason: "provider_conflict",
      });
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(1);
    },
    { post: "conflict" },
  );
});

it("refuses a subscription that acquired an unrelated schedule", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      expect((await client.attachRenewalSchedule(ctx, options)).status).toBe(
        "not_dispatched",
      );
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(0);
    },
    {
      fresh(subscription) {
        subscription.schedule = "sub_sched_foreign";
      },
    },
  );
});

it("refuses changed paid terms before dispatch", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      expect((await client.attachRenewalSchedule(ctx, options)).status).toBe(
        "not_dispatched",
      );
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(0);
    },
    {
      fresh(subscription) {
        subscription.items.data[0].quantity++;
      },
    },
  );
});

it("refuses an expired original window without refreshing it", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      expect((await client.attachRenewalSchedule(ctx, options)).status).toBe(
        "not_dispatched",
      );
      expect(calls).toEqual([]);
    },
    {
      record(record) {
        record.timingPolicy.workEndWallMs = Date.now() - 1;
      },
    },
  );
});

it("admits only one of two concurrent invocations", async () => {
  await attachmentFixture(async ({ client, ctx, options, calls }) => {
    const results = await Promise.all([
      client.attachRenewalSchedule(ctx, options),
      client.attachRenewalSchedule(ctx, options),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([
      "attached_incomplete",
      "conflict",
    ]);
    expect(calls.filter((row) => row.method === "POST")).toHaveLength(1);
  });
});

it("refuses a live credential before accessing the provider", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      expect(await client.attachRenewalSchedule(ctx, options)).toMatchObject({
        status: "not_dispatched",
        reason: "test_mode_key_required",
      });
      expect(calls).toEqual([]);
    },
    { key: "sk_live_invalid_never_send" },
  );
});

it("reports a timed-out dispatch as uncertain and never retries it", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      expect(await client.attachRenewalSchedule(ctx, options)).toMatchObject({
        status: "timeout",
        outcome: "unknown",
      });
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(1);
      expect((await client.attachRenewalSchedule(ctx, options)).status).toBe(
        "conflict",
      );
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(1);
    },
    {
      post: "timeout",
      record(record) {
        record.timingPolicy.workEndWallMs = Date.now() + 500;
        record.timingPolicy.endWallMs = Date.now() + 600;
      },
    },
  );
});

it("reports timeout when a fulfilled POST is followed by journal work beyond the original deadline", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      expect(await client.attachRenewalSchedule(ctx, options)).toMatchObject({
        status: "timeout",
        outcome: "unknown",
      });
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(1);
      const operation = await ctx.runQuery(
        components.betterStripe.renewalOperations.queries
          .loadAuthorizedOperation,
        { operationId: options.operationId },
      );
      expect(operation?.activeAttempt).not.toBeNull();
      const manifest = await ctx.runQuery(
        components.betterStripe.renewalOperations.queries.readAttempt,
        {
          operationId: options.operationId,
          attemptId: operation!.activeAttempt!.attemptId,
        },
      );
      expect(manifest?.events.map((event) => event.sequence)).toEqual([1, 2]);
      expect(
        await ctx.runQuery(
          components.betterStripe.renewalOperations.queries
            .readProviderAcknowledgement,
          { operationId: options.operationId },
        ),
      ).toBeNull();
    },
    {
      delayResponseJournalMs: 700,
      record(record) {
        record.timingPolicy.workEndWallMs = Date.now() + 500;
        record.timingPolicy.endWallMs = Date.now() + 600;
      },
    },
  );
});

it("reports monotonic expiry during initial basis binding while wall time remains below its deadline", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls, record }) => {
      expect(await client.attachRenewalSchedule(ctx, options)).toMatchObject({
        status: "timeout",
        outcome: "unknown",
      });
      expect(Date.now()).toBeLessThan(record.timingPolicy.workEndWallMs);
      expect(calls).toEqual([]);
    },
    {
      delayBasisJournalMs: 700,
      record(record) {
        record.timingPolicy.workEndWallMs = Date.now() + 500;
        record.timingPolicy.endWallMs = Date.now() + 600;
      },
    },
  );
});
