import assert from "node:assert/strict";
import { vi } from "vitest";
import { declaredInputs, declaredEntries, clone } from "./attachEntries.js";
import {
  data,
  barriers,
  installDigestBarrier,
  observe,
} from "./attachScenarioBarriers.js";
import {
  observationState,
  installObservers,
  controlView,
  cleanAttachMocks,
} from "./attachObservations.js";
import { scenarioAssertions } from "./attachScenarioAssertions.js";
export async function scenario(name: string) {
  vi.resetModules();
  const retainedResult = name === "INITIAL-TRUTHY" ? 1 : true;
  const declared = declaredInputs(name),
    { original } = declared;
  const state = observationState(),
    gates = barriers(),
    start = original.attachRequest.firstDispatchedAt * 1000,
    wall = start + 1;
  const NativeDate = Date;
  vi.stubGlobal(
    "Date",
    class extends NativeDate {
      constructor(value?: string | number) {
        super(value ?? wall);
      }
      static now() {
        return wall;
      }
    },
  );
  installDigestBarrier(state, name, gates);
  const listeners = new Set<() => void>();
  let samples = 0;
  const basis = Object.freeze({
      startWallMs: start,
      startNs: BigInt(start) * 1000000n,
      workEndWallMs: start + 180000,
      workEndNs: BigInt(start + 180000) * 1000000n,
      endWallMs: start + 210000,
      endNs: BigInt(start + 210000) * 1000000n,
    }),
    origin = Object.freeze({});
  const source = Object.freeze({
    clock: Object.freeze({
      basis,
      sample() {
        samples++;
        return { wallMs: wall, ns: BigInt(wall) * 1000000n };
      },
      subscribeRetirement(fn: () => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    }),
    originalPolicy: Object.freeze({
      firstDispatchedAt: original.attachRequest.firstDispatchedAt,
      periodStart: original.attachRequest.preparation.expected.periodStart,
      periodEnd: original.attachRequest.preparation.expected.periodEnd,
    }),
    originAssociation: origin,
  });
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => source,
  }));
  const { OWNER } = await import("../originalOwner.js");
  OWNER.check();
  const originalBasis = OWNER.basis;
  const api = await import("../../../renewalV2/index.js");
  const prepared = await api.prepareRenewalPriceReplacementV2(
    original.attachRequest.preparation,
  );
  OWNER.check();
  const request = await api.prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: original.attachRequest.apiVersion,
    attachKey: original.attachRequest.attachKey,
    firstDispatchedAt: original.attachRequest.firstDispatchedAt,
  });
  OWNER.check();
  const { ownedRetainedEligibility } = await import("../material/capture.js"),
    { validateOwnedReadMaterial } = await import("../material/readMaterial.js");
  const reads = validateOwnedReadMaterial(
    {
      apiVersion: original.attachRequest.apiVersion,
      observedAt: original.attachRequest.firstDispatchedAt,
      freshSubscription: original.originalBundle.wireSubscription,
      targetPrice: original.originalBundle.wireTargetPrice,
      billingCustomer: original.originalBundle.wireBillingCustomer,
    },
    prepared,
    undefined,
    ownedRetainedEligibility(original),
  );
  OWNER.check();
  const entries = declaredEntries(
    original,
    prepared,
    request,
    reads,
    declared.coverageCurrent,
    retainedResult,
  );
  const query = String(
    new URLSearchParams(
      ["discounts", "items.data.discounts", "items.data.price"].map(
        (value, i) => ["expand[" + i + "]", value],
      ),
    ),
  );
  const resources = [
    { resource: "subscription", id: prepared.expected.subscriptionId },
    { resource: "price", id: prepared.expected.targetPriceId },
    {
      resource: "customer",
      id: original.originalBundle.wireBillingCustomer.id,
    },
    ...original.originalBundle.couponReads.map((row) => ({
      resource: "coupon",
      id: row.couponId,
    })),
  ];
  const plural: Record<string, string> = {
    subscription: "subscriptions",
    price: "prices",
    customer: "customers",
    coupon: "coupons",
  };
  const plan = Object.freeze(
    resources.map((row, i) => {
      assert.equal(typeof row.id, "string");
      return Object.freeze({
        resource: row.resource,
        ordinal: i + 1,
        method: "GET",
        path:
          "/v1/" +
          plural[row.resource] +
          "/" +
          encodeURIComponent(row.id as string) +
          (i === 0 ? "?" + query : ""),
        body: undefined,
        options: Object.freeze({
          apiVersion: original.attachRequest.apiVersion,
          maxNetworkRetries: 0,
        }),
      });
    }),
  );
  type Row = {
    method: string;
    path: string;
    ordinal?: number;
    resource?: string;
    bundle?: typeof original.originalBundle;
    bRead?: boolean;
    bPost?: boolean;
    reject?: boolean;
    fulfill?: unknown;
  };
  const table: readonly Row[] = Object.freeze(
    [
      ...plan.map((row) => ({ ...row, bundle: original.originalBundle })),
      {
        method: "POST",
        path: "/v1/subscription_schedules",
        reject: name !== "G09-q" && name !== "INITIAL-ACK",
        fulfill: declared.aPost,
      },
      ...plan.map((row) => ({ ...row, bundle: declared.current, bRead: true })),
      {
        method: "POST",
        path: "/v1/subscription_schedules",
        fulfill: declared.bPost,
        bPost: true,
        reject: name === "G11-rejected",
      },
    ].map((row) => Object.freeze(row)),
  );
  const calls: {
      method: string;
      path: string;
      headers: Record<string, string>;
      body: unknown;
    }[] = [],
    posts: typeof calls = [];
  vi.stubGlobal("fetch", async (input: unknown, init: RequestInit) => {
    const url = new URL(String(input)),
      path = url.pathname + url.search,
      row = table[calls.length];
    assert(row, "UNDECLARED_HTTP");
    assert.equal(url.origin, "https://api.stripe.com");
    assert.equal(init.redirect, "error");
    assert.equal(init.method, row.method);
    assert.equal(path, row.path);
    const call = {
      method: String(init.method),
      path,
      headers: Object.fromEntries(new Headers(init.headers)),
      body: init.body,
    };
    calls.push(call);
    if (
      row.bRead &&
      row.ordinal === 1 &&
      ["G09-q", "G11-rejected", "G07-GET"].includes(name)
    )
      await gates.hold("B_GET");
    if (row.bPost && name === "G13-late") await gates.hold("B_POST");
    if (row.method === "POST") posts.push(call);
    if (row.reject)
      throw Object.assign(Error("SYNTHETIC_UNKNOWN_POST"), {
        code: "ECONNRESET",
      });
    let body: unknown = row.fulfill;
    if (row.method === "GET") {
      assert(row.bundle);
      const b = row.bundle;
      body =
        row.resource === "subscription"
          ? b.wireSubscription
          : row.resource === "price"
            ? b.wireTargetPrice
            : row.resource === "customer"
              ? b.wireBillingCustomer
              : b.couponReads.find(
                  (value) =>
                    value.couponId === resources[(row.ordinal ?? 0) - 1].id,
                )?.wireCoupon;
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": "req_SYNTHETIC_RECOVERY",
      },
    });
  });
  const { getStripeClient } = await import("../../../../helpers.js");
  const client = getStripeClient(
      "sk_test_SYNTHETIC_RECOVERY_NO_CREDENTIAL",
      original.attachRequest.apiVersion,
      { singleAttempt: true },
    ),
    rawMethod = client.rawRequest;
  const delegate = Object.freeze({
    rawRequest(...args: unknown[]) {
      const p: Promise<unknown> = Reflect.apply(rawMethod, client, args);
      if (args[0] === "POST")
        state.pending.push(
          p.then(
            (value) => {
              if (posts.length === 1) state.aReply = value;
            },
            () => {},
          ),
        );
      return p;
    },
  });
  let slotTakes = 0,
    settled = false,
    unknown = false,
    reserved = false,
    sourceLoads = 0,
    reservations = 0;
  let record: unknown = Object.freeze({
    originalRaw: original,
    originalPrepared: prepared,
    completeRequest: request,
    retainedMaterial: entries.retained,
  });
  if (name === "G05-record") {
    const bad = data(clone(record));
    data(data(bad.completeRequest).payload).from_subscription = "sub_FOREIGN";
    record = bad;
  }
  const originalSlot = {
    rawAttachRequest: clone(original.attachRequest),
    originalBundle: clone(original.originalBundle),
  };
  const sinkA = Object.freeze({
    send(value: unknown, ack: (value: unknown) => void) {
      OWNER.check();
      const r = data(value);
      state.aRecords.push(r);
      state.aCallbacks.push(ack);
      ack({ sequence: r.sequence, binding: r.binding });
    },
  });
  const sinkB = Object.freeze({
    send(value: unknown, ack: (value: unknown) => void) {
      OWNER.check();
      const r = data(value);
      state.records.push(r);
      state.callbacks.push(ack);
      if (["G08-ack", "G07-ACK"].includes(name) && r.sequence === 1) {
        gates.get("B_ACK").entered.resolve();
        return Promise.resolve();
      }
      ack({ sequence: r.sequence, binding: r.binding });
    },
  });
  const opA = Object.freeze({
    owner: OWNER,
    originAssociation: origin,
    slot: Object.freeze({
      takeOnce(owner: unknown) {
        assert.equal(owner, OWNER);
        slotTakes++;
        assert.equal(slotTakes, 1);
        return originalSlot;
      },
    }),
    readPlan: plan,
    delegate,
    sink: sinkA,
  });
  const opB = Object.freeze({
    owner: OWNER,
    originAssociation: origin,
    originalEntry:
      name === "G04-entry"
        ? Object.freeze({ ...entries.entry })
        : entries.entry,
    originalRecord: record,
    readPlan: plan,
    delegate,
    sink: sinkB,
    reserve(owner: unknown, claimedOrigin: unknown, entry: unknown) {
      OWNER.check();
      assert.equal(owner, OWNER);
      assert.equal(claimedOrigin, origin);
      assert.equal(entry, entries.entry);
      assert(settled && unknown && !reserved);
      reserved = true;
      reservations++;
      return Object.freeze({});
    },
  });
  const frameA = Object.freeze({
      owner: OWNER,
      operation: opA,
      request,
      readPlan: plan,
      delegate,
    }),
    frameB = Object.freeze({
      owner: OWNER,
      operation: opB,
      request,
      readPlan: plan,
      delegate,
    });
  vi.doMock("../operations/sourceOperations.js", () => ({
    COMPILED_INITIAL_ENTRIES: Object.freeze([entries.entry]),
    COMPILED_RECOVERY_ENTRIES: Object.freeze([entries.relation]),
    ORIGINAL_ORIGIN_ASSOCIATION: origin,
    loadFixedInitialOperation: () => opA,
    loadFixedExplicitRecoveryOperation() {
      OWNER.check();
      assert(settled && unknown);
      assert.equal(OWNER.basis, originalBasis);
      sourceLoads++;
      state.recovering = true;
      return opB;
    },
    loadInitialOwnedTransportSource: () => frameA,
    loadRecoveryOwnedTransportSource: () => frameB,
    loadOwnedTransportSource: () =>
      Object.freeze({ owner: OWNER, request, readPlan: plan, delegate }),
  }));
  await installObservers(state, name, () => OWNER.retire());
  const { captureOwnedInitialAttachV2 } =
    await import("../operations/initialAttach.js");
  const captured = captureOwnedInitialAttachV2();
  let aOutcome: unknown = null,
    prior: unknown = { hostVersion: 1 };
  const health = () =>
    assert.deepEqual(state.observerErrors, [], "TEST_OBSERVER_HEALTH");
  const runInitial = async () => {
    assert(!settled);
    let error: unknown;
    try {
      aOutcome = await captured.invoke();
    } catch (value) {
      error = value;
    }
    OWNER.check();
    settled = true;
    assert(state.pairA);
    if (name === "INITIAL-ACK") {
      if (error !== undefined) throw error;
      assert.equal(data(aOutcome).status, "attach_acknowledged");
      assert.equal(state.aRecords.length, 3);
      return data(aOutcome);
    }
    if (name === "G09-q") {
      assert.equal(
        state.pairA.transport.postDisposition(),
        "FULFILLED_UNVERIFIED",
      );
      assert.equal(data(aOutcome).status, "fulfilled_unverified");
    } else {
      assert(error instanceof Error);
      assert.equal(error.message, "INITIAL_PROVIDER_REJECTED");
      assert.equal(
        data(Object.getOwnPropertyDescriptor(error, "failure")?.value).outcome,
        "unknown",
      );
      assert.equal(state.pairA.transport.postDisposition(), "REJECTED");
    }
    unknown = true;
    assert.equal(posts.length, 1);
    assert.equal(state.aRecords.length, 1);
    assert.deepEqual(data(state.aRecords[0].data).request, request);
    if (name === "G15-prior")
      prior = clone(
        await api.constructRenewalScheduleAttachmentReceiptV2({
          attachRequest: original.attachRequest,
          actualDispatch: {
            scope: request.scope,
            apiVersion: request.apiVersion,
            method: request.method,
            path: request.path,
            payload: request.payload,
            key: request.key,
            firstDispatchedAt: request.firstDispatchedAt,
          },
          providerSnapshot: declared.post,
        }),
      );
    health();
    return data(aOutcome ?? {});
  };
  const captureB = async () => {
    assert(settled);
    const { captureOwnedExplicitAttachRecoveryV2 } =
      await import("../recovery/recoveryActor.js");
    return captureOwnedExplicitAttachRecoveryV2();
  };
  const releaseAck = () => {
    const r = state.records[0];
    if (r) state.callbacks[0]({ sequence: r.sequence, binding: r.binding });
  };
  const fixture = {
    OWNER,
    original,
    declared,
    prepared,
    request,
    reads,
    entries,
    state,
    record,
    plan,
    calls,
    posts,
    originalBasis,
    getStats: () => ({ sourceLoads, reservations, slotTakes }),
    health,
  };
  return Object.freeze({
    OWNER,
    binding: Object.freeze({
      opA,
      opB,
      plan,
      delegate,
      request,
      entry: entries.entry,
      origin,
    }),
    runInitial,
    invokeInitial: () => captured.invoke(),
    retainedPredicateState: () => Object.freeze({ ...entries.stats }),
    captureB,
    invokeB: async () => {
      try {
        return data(await (await captureB()).invoke());
      } finally {
        health();
      }
    },
    invokeNewCapture: async () => (await captureB()).invoke(),
    effectCounts: () => ({
      POST: posts.length,
      GET: calls.filter((row) => row.method === "GET").length,
      samples,
      records: state.records.length,
      sourceLoads,
      reservations,
    }),
    bPosts: () => posts.length - 1,
    bGetCount: () =>
      calls.filter((row) => row.method === "GET").length - plan.length,
    bRecords: () => state.records,
    aRecords: () => state.aRecords,
    c3Entries: () => state.c3Entries,
    controlB: () => controlView(state.control),
    pairB: () => {
      assert(state.pairB);
      return state.pairB;
    },
    get aToken() {
      return state.aToken;
    },
    get aReply() {
      return state.aReply;
    },
    get aQuarantine() {
      return aOutcome === null ? null : data(aOutcome).quarantine;
    },
    get priorReceipt() {
      return prior;
    },
    priorSnapshot: () => clone(prior),
    priorIsFrozen: () => Object.isFrozen(prior),
    oldAck: (value: unknown) => state.aCallbacks[0](value),
    releaseAck,
    observe,
    async enterOrSettled(label: string, pending: Promise<unknown>) {
      const entered = await Promise.race([
        gates.get(label).entered.promise.then(() => true),
        pending.then(() => false),
      ]);
      assert.equal(entered, true, "TEST_PREREQUISITE_SETTLED_BEFORE_BARRIER");
      if (name === "G07-C3") {
        assert.equal(state.c3Entries, 1);
        assert.equal(state.c3AtPrefix, 2);
      }
    },
    release: (label: string) => gates.release(label),
    joinObservers: async () => {
      await Promise.allSettled(state.pending);
    },
    mutateUnusedDelivery() {
      originalSlot.rawAttachRequest.attachKey = "UNUSED_CALLER_MUTATION";
    },
    ...scenarioAssertions(fixture),
    health,
    async cleanup() {
      gates.releaseAll();
      if (["G08-ack", "G07-ACK"].includes(name)) releaseAck();
      await Promise.allSettled(state.pending);
      cleanAttachMocks();
    },
  });
}
export type Scenario = Awaited<ReturnType<typeof scenario>>;
