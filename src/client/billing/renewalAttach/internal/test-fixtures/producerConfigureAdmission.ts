import assert from "node:assert/strict";
import { afterEach, beforeEach, vi } from "vitest";
import { initialOperations } from "./producerInitialOperation.js";
import { makeConfigureReadNativeBaseline } from "./configureReadNativeBaseline.js";
import { captureRetainedInput } from "../material/capture.js";
import { captureInitialInvocationCore } from "../producer/invocationProducer.js";
import { createClassActionOperationJournal } from "../operationJournal.js";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { BetterStripe } from "../../../../index.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  projectRenewalConfigurationV2,
} from "../../../renewalV2/index.js";
import { INITIAL_NS } from "./producerInitialDeclarations.js";

const controls = vi.hoisted(() => ({
  entries: [{ coversRetained: () => true, coversFresh: () => true }],
  recovery: [] as { originalEntry: unknown; coversReplay(): boolean }[],
  legacy: 0,
  selectors: 0,
}));
vi.mock("../operations/sourceOperations.js", () => {
  const poison = () => {
    controls.legacy++;
    throw Error("LEGACY_SOURCE_POISON");
  };
  return {
    COMPILED_INITIAL_ENTRIES: controls.entries,
    COMPILED_RECOVERY_ENTRIES: controls.recovery,
    ORIGINAL_ORIGIN_ASSOCIATION: null,
    loadFixedInitialOperation: poison,
    loadFixedExplicitRecoveryOperation: poison,
    loadOwnedTransportSource: poison,
    loadInitialOwnedTransportSource: poison,
    loadRecoveryOwnedTransportSource: poison,
  };
});
vi.mock("../originalOwner.js", () => {
  const poison = () => {
    controls.legacy++;
    throw Error("LEGACY_OWNER_POISON");
  };
  return {
    OWNER: Object.freeze({
      get basis() {
        return poison();
      },
      check: poison,
      sample: poison,
      subscribe: poison,
      retire: poison,
    }),
  };
});
vi.mock("../../../../helpers.js", async (original) => {
  const actual = await original<typeof import("../../../../helpers.js")>();
  return {
    ...actual,
    getStripeClient(...args: Parameters<typeof actual.getStripeClient>) {
      controls.selectors++;
      return actual.getStripeClient(...args);
    },
  };
});
export const admissionControls = controls;
const canonical = (value: unknown) => JSON.stringify(renewalSnapshot(value));
beforeEach(() => {
  controls.legacy = 0;
  controls.selectors = 0;
  controls.entries.splice(0, controls.entries.length, {
    coversRetained: () => true,
    coversFresh: () => true,
  });
  controls.recovery.splice(0, controls.recovery.length, {
    originalEntry: controls.entries[0],
    coversReplay: () => true,
  });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(
    (makeConfigureReadNativeBaseline().clockPlan.attachSeconds + 1) * 1000,
  );
  vi.spyOn(process.hrtime, "bigint").mockReturnValue(INITIAL_NS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(
  input: Parameters<Parameters<typeof initialOperations>[0]>[0],
  completion: { mode: string; posts: number },
) {
  const { journal, fresh, sdk, ctx, index } = input;
  assert(fresh.result.disposition === "acquired" && fresh.call);
  const parentReservation = fresh.result.reservation;
  const baseline = makeConfigureReadNativeBaseline();
  const source = captureRetainedInput(baseline.original);
  const calls: { method: string; path: string }[] = [];
  const routes = new Map<string, unknown>([
    ["/v1/subscriptions/sub_original", source.originalBundle.wireSubscription],
    ["/v1/prices/price_target", source.originalBundle.wireTargetPrice],
    ["/v1/customers/cus_buyer", source.originalBundle.wireBillingCustomer],
    ...source.originalBundle.couponReads.map((row): [string, unknown] => [
      "/v1/coupons/" + encodeURIComponent(String(row.couponId)),
      row.wireCoupon,
    ]),
  ]);
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "";
    calls.push({ method, path });
    if (method === "POST") {
      completion.posts++;
      if (completion.mode === "replay" && completion.posts === 1)
        throw Error("CONTROLLED_LOST_RESPONSE");
    }
    const body = method === "POST" ? baseline.schedule : routes.get(path);
    assert(body);
    assert(
      method === "GET" ||
        (method === "POST" && path === "/v1/subscription_schedules"),
    );
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": "req_synthetic_admission",
      },
    });
  });
  const core = await captureInitialInvocationCore(fresh.call, journal);
  let childOrdinal = 0;
  async function child(
    options: {
      sdk?: BetterStripe;
      stage?: "attach" | "configure";
      ctx?: typeof ctx;
      change?: (record: Record<string, unknown>) => void;
    } = {},
  ) {
    const ordinal = ++childOrdinal;
    const loaded = await journal.loadAuthorizedOperation();
    assert(loaded);
    const parent = JSON.parse(loaded.recordJSON);
    const prepared = await prepareRenewalPriceReplacementV2(
      source.attachRequest.preparation,
    );
    const attach = await prepareRenewalScheduleAttachmentV2({
      prepared,
      apiVersion: source.attachRequest.apiVersion,
      attachKey: source.attachRequest.attachKey,
      firstDispatchedAt: source.attachRequest.firstDispatchedAt,
    });
    const configuration = {
      preparation: source.attachRequest.preparation,
      attachReceipt: {
        attachRequest: source.attachRequest,
        actualDispatch: {
          scope: attach.scope,
          apiVersion: attach.apiVersion,
          method: attach.method,
          path: attach.path,
          payload: attach.payload,
          key: attach.key,
          firstDispatchedAt: attach.firstDispatchedAt,
        },
        providerSnapshot: baseline.schedule,
      },
      freshSubscription: {
        ...source.attachRequest.preparation.subscription,
        schedule: baseline.schedule.id,
      },
      targetPrice: source.attachRequest.preparation.targetPrice,
      billingCustomer: source.attachRequest.preparation.billingCustomer,
      schedule: baseline.schedule,
      apiVersion: source.attachRequest.apiVersion,
      observedAt: baseline.configurationTime,
      firstDispatchedAt: baseline.configurationTime,
      configureKey: "configure:admission:root" + index + ":" + ordinal,
    };
    const request = await projectRenewalConfigurationV2(configuration);
    assert("requestIdentity" in request);
    const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
      request;
    const known = await journal.readProviderAcknowledgement();
    assert(known);
    const record = {
      schemaVersion: 2,
      authorization: {
        scope: "configure-child-host",
        id: "configure-consent-root" + index + "-" + ordinal,
        revision: 1,
      },
      logicalOperationId: "configure-child-root" + index + "-" + ordinal,
      stage: "configure",
      account: parent.account,
      apiVersion,
      requestBinding: request.requestIdentity.binding,
      dispatch: {
        scope,
        apiVersion,
        method,
        path,
        payload,
        key,
        firstDispatchedAt,
      },
      parentAttachment: {
        operationId: parentReservation.operationId,
        attemptId: parentReservation.attemptId,
        sourcePayloadId: parentReservation.payloadId,
        receiptBinding: known.retention.receiptBinding,
      },
      configureRecord: {
        configuration,
        request,
        attachReceipt: JSON.parse(known.receiptJSON),
        originalBundle: source.originalBundle,
      },
      timingPolicy: { ...parent.timingPolicy, firstDispatchedAt },
    };
    options.change?.(record);
    const recordJSON = canonical(record);
    const selectedCtx = options.ctx ?? ctx;
    const refs = components.betterStripe.renewalOperations;
    const created = await selectedCtx.runMutation(
      refs.mutations.createAuthorizedOperation,
      {
        authorizationScope: record.authorization.scope,
        authorizationRevision: 1,
        logicalOperationId: record.logicalOperationId,
        recordJSON,
      },
    );
    assert(created.status === "created");
    const childJournal = await createClassActionOperationJournal(
      options.sdk ?? sdk,
      { actualActionCtx: selectedCtx, operationId: created.operationId },
    );
    const reserveArgs = {
      expectedRevision: 0,
      stage: options.stage ?? "configure",
      expectedRequestBinding: record.requestBinding,
      recordJSON,
    };
    const childFresh = await childJournal.reserveFreshAttempt(reserveArgs);
    assert(childFresh.result.disposition === "acquired" && childFresh.call);
    return {
      journal: childJournal,
      fresh: childFresh,
      record,
      reserveArgs,
      created,
    };
  }
  async function complete(mode: "initial" | "replay" | "resume" = "initial") {
    completion.mode = mode;
    if (mode === "initial") return core.initialAttach().invoke();
    try {
      await core.initialAttach().invoke();
    } catch (error) {
      if (mode !== "replay") throw error;
    }
    return core.recoverAttach().invoke();
  }
  return { ...input, core, child, calls, baseline, source, complete };
}
export async function configureAdmissionFixture(
  work: (h: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  options: {
    count?: number;
    keys?: readonly string[];
    afterBind?: (reply: unknown) => Promise<void>;
    afterQuery?: (
      reply: unknown,
      reference: string,
      args: unknown,
    ) => Promise<void>;
    afterAppend?: () => Promise<void>;
  } = {},
) {
  const baseline = makeConfigureReadNativeBaseline();
  const completion = { mode: "initial", posts: 0, appends: 0 };
  await initialOperations(
    async (input) => {
      const h = await setup(input, completion);
      try {
        await work(h);
      } finally {
        h.core.owner.retire();
      }
    },
    options.count ?? 1,
    {
      keys: options.keys,
      source: captureRetainedInput(baseline.original),
      afterBind: options.afterBind,
      afterQuery: options.afterQuery,
      afterAppend: async () => {
        completion.appends++;
        if (completion.mode === "resume" && completion.appends === 2)
          throw Error("CONTROLLED_APPEND_REPLY_REJECTION");
        await options.afterAppend?.();
      },
      workEndWallMs:
        (baseline.clockPlan.attachSeconds + baseline.clockPlan.workSeconds) *
        1000,
      endWallMs:
        (baseline.clockPlan.attachSeconds + baseline.clockPlan.endSeconds) *
        1000,
    },
  );
}
