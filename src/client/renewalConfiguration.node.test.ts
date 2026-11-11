import type { ConfigureRenewalScheduleOptions } from "./renewalConfigurationTypes.js";
import { prepareRenewalConfigurationOperation } from "./node.js";
import { components } from "../../example/convex/_generated/api.js";
import { afterEach, expect, it, vi } from "vitest";
import { attachmentFixture } from "./renewalAttachmentTestHelpers.js";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("configures the acknowledged attachment once through the public Node API", async () => {
  await attachmentFixture(
    async ({ client, ctx, options, calls }) => {
      const attached = await client.attachRenewalSchedule(ctx, options);
      expect(attached.status).toBe("attached_incomplete");
      const configure = await prepare({ ctx, options });
      const result = await client.configureRenewalSchedule(ctx, configure);
      expect(result.status).toBe("configure_acknowledged");
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(2);
      expect(
        (await client.configureRenewalSchedule(ctx, configure)).status,
      ).toBe("conflict");
      expect(calls.filter((row) => row.method === "POST")).toHaveLength(2);
    },
    { configure: true },
  );
});

async function prepare({
  ctx,
  options,
}: Pick<
  Parameters<Parameters<typeof attachmentFixture>[0]>[0],
  "ctx" | "options"
>) {
  const refs = components.betterStripe.renewalOperations;
  const parent = await ctx.runQuery(refs.queries.loadAuthorizedOperation, {
    operationId: options.operationId,
  });
  const ack = await ctx.runQuery(refs.queries.readProviderAcknowledgement, {
    operationId: options.operationId,
  });
  const prepared = await prepareRenewalConfigurationOperation({
    attachment: {
      operationId: options.operationId,
      recordJSON: parent!.recordJSON,
      attemptId: parent!.activeAttempt!.attemptId,
      sourcePayloadId: parent!.activeAttempt!.payloadId,
      receiptJSON: ack!.receiptJSON,
    },
    authorization: { scope: "test-host", id: "consent", revision: 1 },
    logicalOperationId: "configure-one",
    configureKey: "configure:public:one",
    firstDispatchedAt: Math.floor(Date.now() / 1000),
  });
  const created = await ctx.runMutation(
    refs.mutations.createAuthorizedOperation,
    prepared.createArgs,
  );
  expect(created.status).toBe("created");
  if (created.status !== "created") throw Error("fixture conflict");
  const configure = {
    operationId: created.operationId,
    requestBinding: prepared.requestBinding,
    authorizationQuery:
      options.authorizationQuery as unknown as ConfigureRenewalScheduleOptions["authorizationQuery"],
  };
  return configure;
}

it.each([
  {
    name: "revoked authorization",
    overrides: { configureAuthorization: false },
    status: "not_dispatched",
    writes: 1,
  },
  {
    name: "raw original drift",
    overrides: { configureDrift: true },
    status: "not_dispatched",
    writes: 1,
  },
  {
    name: "lost response",
    overrides: { configurePost: "lost" as const },
    status: "unknown",
    writes: 2,
  },
  {
    name: "provider conflict",
    overrides: { configurePost: "conflict" as const },
    status: "conflict",
    writes: 2,
  },
])(
  "handles $name without another provider write",
  async ({ overrides, status, writes }) => {
    await attachmentFixture(
      async (h) => {
        expect(
          (await h.client.attachRenewalSchedule(h.ctx, h.options)).status,
        ).toBe("attached_incomplete");
        const options = await prepare(h);
        expect(
          (await h.client.configureRenewalSchedule(h.ctx, options)).status,
        ).toBe(status);
        expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(writes);
        const result = await h.client.configureRenewalSchedule(h.ctx, options);
        expect(["conflict", "not_dispatched"]).toContain(result.status);
        expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(writes);
      },
      { configure: true, ...overrides },
    );
  },
);
it("refuses a foreign request binding without consuming the live attachment", async () => {
  await attachmentFixture(
    async (h) => {
      await h.client.attachRenewalSchedule(h.ctx, h.options);
      const options = await prepare(h),
        count = h.calls.length;
      expect(
        await h.client.configureRenewalSchedule(h.ctx, {
          ...options,
          requestBinding: "foreign",
        }),
      ).toMatchObject({
        status: "conflict",
        reason: "request_binding_mismatch",
      });
      expect(h.calls).toHaveLength(count);
      expect(
        (await h.client.configureRenewalSchedule(h.ctx, options)).status,
      ).toBe("configure_acknowledged");
    },
    { configure: true },
  );
});
it("retains exact quantity and paid phase through the verified boundary", async () => {
  await attachmentFixture(
    async (h) => {
      await h.client.attachRenewalSchedule(h.ctx, h.options);
      const options = await prepare(h);
      const result = await h.client.configureRenewalSchedule(h.ctx, options);
      expect(result.status).toBe("configure_acknowledged");
      if (result.status !== "configure_acknowledged")
        throw Error("missing ack");
      const phases = result.receipt.request.payload.phases,
        expected = h.record.attachRequest.preparation.expected;
      expect(phases[0]).toMatchObject({
        start_date: expected.periodStart,
        end_date: expected.periodEnd,
        items: [{ price: expected.currentPriceId, quantity: 3 }],
      });
      expect(phases[1]).toMatchObject({
        start_date: expected.periodEnd,
        items: [{ price: expected.targetPriceId, quantity: 3 }],
        proration_behavior: "none",
      });
      const ack = await h.ctx.runQuery(
        components.betterStripe.renewalOperations.queries
          .readProviderAcknowledgement,
        { operationId: options.operationId },
      );
      expect(JSON.parse(ack!.receiptJSON).binding).toBe(result.receipt.binding);
    },
    { configure: true },
  );
});

it("qualifies exact inactive defaults only under the explicit configure profile", async () => {
  await attachmentFixture(
    async (h) => {
      await h.client.attachRenewalSchedule(h.ctx, h.options);
      const options = await prepare(h);
      expect(
        (await h.client.configureRenewalSchedule(h.ctx, options)).status,
      ).toBe("configure_acknowledged");
    },
    {
      configure: true,
      source(source) {
        Object.assign(source.attachRequest.preparation.subscription, {
          managed_payments: { enabled: false },
          trial_start: null,
          trial_end: null,
          trial_settings: {
            end_behavior: {
              billing_cycle_anchor: "now",
              missing_payment_method: "create_invoice",
            },
          },
        });
        source.originalBundle.wireSubscription = structuredClone(
          source.attachRequest.preparation.subscription,
        );
      },
    },
  );
});

it("does not reconstruct live attachment authority on another SDK instance", async () => {
  await attachmentFixture(
    async (h) => {
      await h.client.attachRenewalSchedule(h.ctx, h.options);
      const options = await prepare(h);
      const { BetterStripe } = await import("./node.js");
      const restarted = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_public_attachment",
      });
      const count = h.calls.length;
      expect(
        await restarted.configureRenewalSchedule(h.ctx, options),
      ).toMatchObject({
        status: "not_dispatched",
        reason: "live_attachment_required",
      });
      expect(h.calls).toHaveLength(count);
    },
    { configure: true },
  );
});
it("refuses an expired original monotonic window without refreshing it", async () => {
  let clock = process.hrtime.bigint();
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() => clock);
  await attachmentFixture(
    async (h) => {
      await h.client.attachRenewalSchedule(h.ctx, h.options);
      const options = await prepare(h),
        count = h.calls.length;
      clock += 60_000_000_000n;
      expect(
        await h.client.configureRenewalSchedule(h.ctx, options),
      ).toMatchObject({
        status: "not_dispatched",
        reason: "original_window_expired",
      });
      expect(h.calls).toHaveLength(count);
    },
    { configure: true },
  );
});
it("keeps legacy empty-discount configure guards conservative", async () => {
  await attachmentFixture(
    async (h) => {
      await h.client.attachRenewalSchedule(h.ctx, h.options);
      const options = await prepare(h);
      const loaded = await h.ctx.runQuery(
        components.betterStripe.renewalOperations.queries
          .loadAuthorizedOperation,
        { operationId: options.operationId },
      );
      const configuration = JSON.parse(loaded!.recordJSON).configureRecord
        .configuration;
      delete configuration.executionProfile;
      const { projectRenewalConfigurationV2 } =
        await import("./billing/renewalV2/index.js");
      expect(await projectRenewalConfigurationV2(configuration)).toMatchObject({
        status: "attached_unconfigured",
        reason: "ambiguous_empty_discount_hierarchy",
      });
    },
    { configure: true },
  );
});

it("returns timeout after configure response journal work retires the original owner", async () => {
  await attachmentFixture(
    async (h) => {
      await h.client.attachRenewalSchedule(h.ctx, h.options);
      const options = await prepare(h);
      expect(
        await h.client.configureRenewalSchedule(h.ctx, options),
      ).toMatchObject({ status: "timeout", outcome: "unknown" });
      expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(2);
    },
    {
      configure: true,
      afterConfigureResponse() {
        vi.spyOn(Date, "now").mockReturnValue(9_000_000_000_000);
      },
    },
  );
});

it.each([null, "src_foreign"])(
  "qualifies only the inactive Endive default_source %s",
  async (defaultSource) => {
    await attachmentFixture(
      async (h) => {
        await h.client.attachRenewalSchedule(h.ctx, h.options);
        if (defaultSource !== null) {
          await expect(prepare(h)).rejects.toThrow(
            "unsupported_schedule_defaults",
          );
          expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(1);
          return;
        }
        const options = await prepare(h);
        const stored = await h.ctx.runQuery(
          components.betterStripe.renewalOperations.queries
            .loadAuthorizedOperation,
          { operationId: options.operationId },
        );
        expect(
          JSON.parse(stored!.recordJSON).configureRecord.configuration.schedule
            .default_settings.default_source,
        ).toBeNull();
        expect(
          (await h.client.configureRenewalSchedule(h.ctx, options)).status,
        ).toBe("configure_acknowledged");
      },
      { configure: true, defaultSource },
    );
  },
);

it("compares the retained inactive default_source against fresh schedule drift", async () => {
  await attachmentFixture(
    async (h) => {
      await h.client.attachRenewalSchedule(h.ctx, h.options);
      const options = await prepare(h);
      expect(
        await h.client.configureRenewalSchedule(h.ctx, options),
      ).toMatchObject({ status: "not_dispatched" });
      expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    },
    { configure: true, defaultSource: null, configureDefaultSourceDrift: true },
  );
});
