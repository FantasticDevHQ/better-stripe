import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { initialOperations } from "./producerInitialOperation.js";
import { makeConfigureReadNativeBaseline } from "./configureReadNativeBaseline.js";
import { captureRetainedInput } from "../material/capture.js";
import { captureAdmittedConfigurePreflight } from "../producer/configurePreflight.js";
import { captureInitialInvocationCore } from "../producer/invocationProducer.js";
import { createClassActionOperationJournal } from "../operationJournal.js";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { BetterStripe } from "../../../../index.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  projectRenewalConfigurationV2,
  constructRenewalConfigurationReceiptV2,
} from "../../../renewalV2/index.js";
import { INITIAL_NS } from "./producerInitialDeclarations.js";

const controls = vi.hoisted(() => ({
  entries: [{ coversRetained: () => true, coversFresh: () => true }],
  recovery: [] as { originalEntry: unknown; coversReplay(): boolean }[],
  preflight: [] as {
    originalEntry: unknown;
    coversPreflight(...args: unknown[]): boolean;
  }[],
  write: [] as {
    originalEntry: unknown;
    coversConfigure(...args: unknown[]): boolean;
  }[],
  legacy: 0,
  selectors: 0,
  history: [] as unknown[],
  observation: [] as unknown[],
  onSelect: null as null | ((client: object) => void),
}));
vi.mock("../operations/sourceOperations.js", () => {
  const poison = () => {
    controls.legacy++;
    throw Error("LEGACY_SOURCE_POISON");
  };
  return {
    COMPILED_INITIAL_ENTRIES: controls.entries,
    COMPILED_RECOVERY_ENTRIES: controls.recovery,
    COMPILED_PREFLIGHT_ENTRIES: controls.preflight,
    COMPILED_CONFIGURE_WRITE_ENTRIES: controls.write,
    COMPILED_OBSERVATION_HISTORY_ENTRIES: controls.history,
    COMPILED_FRESH_OBSERVATION_ENTRIES: controls.observation,
    loadConfigureWriteTransportSource: poison,
    loadConfigureReplayTransportSource: poison,
    loadFixedConfigureWriteOperation: poison,
    loadFixedConfigureReplayOperation: poison,
    loadOwnedConfigureOperation: poison,
    loadConfigureOwnedReadTransportSource: poison,
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
      const client = actual.getStripeClient(...args);
      controls.onSelect?.(client);
      return client;
    },
  };
});
export const admissionControls = controls;
const canonical = (value: unknown) => JSON.stringify(renewalSnapshot(value));
function admissionBaseline(targetInterval?: "week") {
  const baseline = makeConfigureReadNativeBaseline();
  if (targetInterval) {
    const target = baseline.original.attachRequest.preparation.targetPrice;
    Object.assign(target.recurring, { interval: targetInterval });
    baseline.original.originalBundle.wireTargetPrice = structuredClone(target);
    const subscription =
      baseline.original.attachRequest.preparation.subscription;
    Object.assign(subscription, { trial_start: null, trial_end: null });
    baseline.original.originalBundle.wireSubscription =
      structuredClone(subscription);
  }
  return baseline;
}
beforeEach(() => {
  controls.legacy = 0;
  controls.preflight.splice(0);
  controls.write.splice(0);
  controls.selectors = 0;
  controls.history.splice(0);
  controls.observation.splice(0);
  controls.onSelect = null;
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
  hooks: {
    beforeFetch?: (path: string, method: string) => Promise<void>;
    targetInterval?: "week";
  },
) {
  const { journal, fresh, sdk, ctx, index } = input;
  assert(fresh.result.disposition === "acquired" && fresh.call);
  const parentReservation = fresh.result.reservation;
  const baseline = admissionBaseline(hooks.targetInterval);
  const source = captureRetainedInput(baseline.original);
  const calls: {
    method: string;
    path: string;
    query: string;
    hasBody: boolean;
    idempotencyKey: string | null;
    apiVersion: string | null;
  }[] = [];
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
    const parsed = new URL(String(url));
    const path = parsed.pathname;
    const method = init?.method ?? "";
    calls.push({
      method,
      path,
      query: parsed.search,
      hasBody: init?.body !== undefined,
      idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      apiVersion: new Headers(init?.headers).get("stripe-version"),
    });
    await hooks.beforeFetch?.(path, method);
    if (method === "POST") {
      completion.posts++;
      if (completion.mode === "replay" && completion.posts === 1)
        throw Error("CONTROLLED_LOST_RESPONSE");
    }
    const body = method === "POST" ? baseline.schedule : routes.get(path);
    assert(body);
    assert(
      method === "GET" ||
        (method === "POST" &&
          (path === "/v1/subscription_schedules" ||
            path === "/v1/subscription_schedules/" + baseline.schedule.id)),
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
  function configureReads(value: Awaited<ReturnType<typeof child>>) {
    const configuration = value.record.configureRecord.configuration;
    const current = {
      subscription: structuredClone(configuration.freshSubscription),
      price: structuredClone(configuration.targetPrice),
      customer: structuredClone(configuration.billingCustomer),
      schedule: structuredClone(configuration.schedule),
      coupons: structuredClone(source.originalBundle.couponReads),
    };
    routes.set("/v1/subscriptions/sub_original", current.subscription);
    routes.set("/v1/prices/price_target", current.price);
    routes.set("/v1/customers/cus_buyer", current.customer);
    routes.set(
      "/v1/subscription_schedules/" + baseline.schedule.id,
      current.schedule,
    );
    for (const row of current.coupons)
      routes.set(
        "/v1/coupons/" + encodeURIComponent(String(row.couponId)),
        row.wireCoupon,
      );
    vi.setSystemTime(baseline.configurationTime * 1000);
    return current;
  }
  async function eventsFor(value: Awaited<ReturnType<typeof child>>) {
    const request = value.record.configureRecord.request;
    const transport = {
      status: 200,
      requestId: "req_synthetic_configure_channel",
    };
    const receipt = await constructRenewalConfigurationReceiptV2({
      configuration: value.record.configureRecord.configuration,
      actualDispatch: value.record.dispatch,
      providerSnapshot: baseline.schedule,
      transport,
    });
    return {
      dispatch: { event: "dispatch", stage: "configure", request },
      response: {
        event: "response",
        stage: "configure",
        request,
        body: baseline.schedule,
        transport,
      },
      receiptEvent: { event: "receipt", stage: "configure", request, receipt },
      receipt,
    };
  }
  return {
    ...input,
    core,
    child,
    calls,
    baseline,
    source,
    complete,
    eventsFor,
    configureReads,
    setControlledRead(path: string, body: unknown) {
      routes.set(path, body);
    },
  };
}
export async function configureAdmissionFixture(
  work: (h: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  options: {
    targetInterval?: "week";
    identity?: NonNullable<Parameters<typeof initialOperations>[2]>["identity"];
    hostQuery?: NonNullable<
      Parameters<typeof initialOperations>[2]
    >["hostQuery"];
    count?: number;
    keys?: readonly string[];
    afterBind?: (reply: unknown) => Promise<void>;
    afterQuery?: (
      reply: unknown,
      reference: string,
      args: unknown,
    ) => Promise<void>;
    afterAppend?: () => Promise<void>;
    beforeAppend?: () => Promise<void>;
    afterRetain?: () => Promise<void>;
    beforeFetch?: (path: string, method: string) => Promise<void>;
  } = {},
) {
  const baseline = admissionBaseline(options.targetInterval);
  const completion = { mode: "initial", posts: 0, appends: 0 };
  await initialOperations(
    async (input) => {
      const h = await setup(input, completion, options);
      try {
        await work(h);
      } finally {
        h.core.owner.retire();
      }
    },
    options.count ?? 1,
    {
      keys: options.keys,
      identity: options.identity,
      hostQuery: options.hostQuery,
      source: captureRetainedInput(baseline.original),
      afterBind: options.afterBind,
      afterQuery: options.afterQuery,
      beforeAppend: options.beforeAppend,
      afterRetain: options.afterRetain,
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

/** Stage real Action prerequisites separately while joining every test continuation. */
export function configureAdmissionCase<T>(
  name: string,
  prepare: (h: Awaited<ReturnType<typeof setup>>) => Promise<T>,
  verify: (h: Awaited<ReturnType<typeof setup>>, state: T) => Promise<void>,
  options: Parameters<typeof configureAdmissionFixture>[1] = {},
) {
  describe(name, () => {
    let pending: Promise<void>,
      start!: () => void,
      run = false;
    beforeEach(async () => {
      run = false;
      let ready!: () => void, failed!: (error: unknown) => void;
      const prepared = new Promise<void>((resolve, reject) => {
        ready = resolve;
        failed = reject;
      });
      const entered = new Promise<void>((resolve) => {
        start = resolve;
      });
      pending = configureAdmissionFixture(async (h) => {
        const state = await prepare(h);
        ready();
        await entered;
        if (run) await verify(h, state);
      }, options);
      void pending.catch(failed);
      await prepared;
    });
    afterEach(async () => {
      start?.();
      await pending?.catch(() => {});
    });
    it(name, async () => {
      run = true;
      start();
      await pending;
    });
  });
}

/** Actual initial ACK, child admission and completed readonly preflight prerequisites. */
export async function prepareAdmittedConfigure(
  h: Awaited<ReturnType<typeof setup>>,
) {
  await h.complete();
  const child = await h.child();
  const token = await h.core.admitConfigure(child.fresh.call, child.journal);
  const current = h.configureReads(child);
  if (controls.preflight.length === 0)
    controls.preflight.push({
      originalEntry: controls.entries[0],
      coversPreflight: () => true,
    });
  if (controls.write.length === 0)
    controls.write.push({
      originalEntry: controls.entries[0],
      coversConfigure: () => true,
    });
  await captureAdmittedConfigurePreflight(token).invoke();
  return { child, token, current };
}
