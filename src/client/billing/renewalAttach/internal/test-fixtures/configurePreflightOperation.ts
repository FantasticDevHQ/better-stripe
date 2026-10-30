import assert from "node:assert/strict";
import { vi } from "vitest";
import { declaredEntries } from "./attachEntries.js";
import {
  declarePreflightCase,
  deepFreeze,
  data,
  replaceRecordToken,
  type PreflightCase,
} from "./configurePreflightControls.js";
import {
  preflightBarriers,
  installPreflightDigestBarrier,
  cleanPreflightMocks,
  preflightObservationState,
  installPreflightObservers,
} from "./configurePreflightBarriers.js";
import type { Configuration } from "../preflight/grammar.js";

/** Closed TEST Source. Real initial ACK is a prerequisite, never a fabricated receipt. */
export async function configurePreflightFixture(
  name: PreflightCase = "positive",
  tokenIndex = 0,
) {
  vi.resetModules();
  const declared = declarePreflightCase(name);
  const gates = preflightBarriers(name);
  try {
    const state = preflightObservationState();
    let now = declared.firstAt;
    const start = declared.original.attachRequest.firstDispatchedAt * 1000;
    const basis = Object.freeze({
      startWallMs: start,
      startNs: BigInt(start) * 1000000n,
      workEndWallMs: start + declared.workSeconds * 1000,
      workEndNs: BigInt(start + declared.workSeconds * 1000) * 1000000n,
      endWallMs: start + declared.endSeconds * 1000,
      endNs: BigInt(start + declared.endSeconds * 1000) * 1000000n,
    });
    const advance = (next: number) => {
      assert(next >= now && next < basis.workEndWallMs);
      now = next;
    };
    const listeners = new Set<() => void>(),
      origin = Object.freeze({});
    const source = Object.freeze({
      clock: Object.freeze({
        basis,
        sample: () => {
          state.samples++;
          return { wallMs: now, ns: BigInt(now) * 1000000n };
        },
        subscribeRetirement(fn: () => void) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      }),
      originalPolicy: {
        firstDispatchedAt: declared.original.attachRequest.firstDispatchedAt,
        periodStart:
          declared.original.attachRequest.preparation.expected.periodStart,
        periodEnd:
          declared.original.attachRequest.preparation.expected.periodEnd,
      },
      originAssociation: origin,
    });
    const NativeDate = Date;
    vi.stubGlobal(
      "Date",
      class extends NativeDate {
        constructor(value?: string | number) {
          super(value ?? now);
        }
        static now() {
          return now;
        }
      },
    );
    installPreflightDigestBarrier(gates, () => state.phase);
    vi.doMock("../sourceBindings.js", () => ({
      loadOwnedOriginalSource: () => source,
    }));
    const { OWNER } = await import("../originalOwner.js");
    const originalBasis = OWNER.basis;
    let retargetReadMethod: () => void = () => {
      throw Error("METHOD_RETARGET_PREREQUISITE");
    };
    const actual = await installPreflightObservers(
      state,
      OWNER,
      name,
      gates,
      () => advance(declared.laterAt),
      () => retargetReadMethod(),
    );
    const { captureRetainedInput, ownedRetainedEligibility } =
      await import("../material/capture.js");
    const original = captureRetainedInput(declared.original);
    const prepared = await actual.prepareRenewalPriceReplacementV2(
      original.attachRequest.preparation,
    );
    OWNER.check();
    const request = await actual.prepareRenewalScheduleAttachmentV2({
      prepared,
      apiVersion: original.attachRequest.apiVersion,
      attachKey: original.attachRequest.attachKey,
      firstDispatchedAt: original.attachRequest.firstDispatchedAt,
    });
    OWNER.check();
    const { validateOwnedReadMaterial } =
      await import("../material/readMaterial.js");
    const reads = validateOwnedReadMaterial(
      {
        apiVersion: declared.apiVersion,
        observedAt: original.attachRequest.firstDispatchedAt,
        freshSubscription: original.originalBundle.wireSubscription,
        targetPrice: original.originalBundle.wireTargetPrice,
        billingCustomer: original.originalBundle.wireBillingCustomer,
      },
      prepared,
      undefined,
      ownedRetainedEligibility(original),
    );
    const entries = declaredEntries(
      original,
      prepared,
      request,
      reads,
      original.originalBundle,
    );
    const query = String(
      new URLSearchParams(
        ["discounts", "items.data.discounts", "items.data.price"].map(
          (value, i) => ["expand[" + i + "]", value],
        ),
      ),
    );
    const paths = [
      "/v1/subscriptions/" + prepared.expected.subscriptionId + "?" + query,
      "/v1/prices/" + prepared.expected.targetPriceId,
      "/v1/customers/" + original.originalBundle.wireBillingCustomer.id,
      ...original.originalBundle.couponReads.map((row) => {
        assert(typeof row.couponId === "string");
        return "/v1/coupons/" + encodeURIComponent(row.couponId);
      }),
    ];
    const row = (path: string, i: number) =>
      deepFreeze({
        resource:
          i === 0
            ? "subscription"
            : i === 1
              ? "price"
              : i === 2
                ? "customer"
                : "coupon",
        ordinal: i + 1,
        method: "GET",
        path,
        body: undefined,
        options: { apiVersion: declared.apiVersion, maxNetworkRetries: 0 },
      });
    const initialPlan = Object.freeze(paths.map(row));
    const schedulePath = "/v1/subscription_schedules/" + declared.schedule.id;
    const configurePlan = Object.freeze([
      ...initialPlan,
      deepFreeze({ ...row(schedulePath, paths.length), resource: "schedule" }),
    ]);
    const originalBodies = [
      original.originalBundle.wireSubscription,
      original.originalBundle.wireTargetPrice,
      original.originalBundle.wireBillingCustomer,
      ...original.originalBundle.couponReads.map((value) => value.wireCoupon),
    ];
    const currentBodies = [
      declared.currentBundle.wireSubscription,
      declared.currentBundle.wireTargetPrice,
      declared.currentBundle.wireBillingCustomer,
      ...declared.currentBundle.couponReads.map((value) => value.wireCoupon),
    ];
    const table = deepFreeze([
      ...paths.map((path, i) => ({
        method: "GET",
        path,
        body: originalBodies[i],
        schedule: false,
      })),
      {
        method: "POST",
        path: "/v1/subscription_schedules",
        body: declared.schedule,
        schedule: false,
      },
      ...paths.map((path, i) => ({
        method: "GET",
        path,
        body: currentBodies[i],
        schedule: false,
      })),
      {
        method: "GET",
        path: schedulePath,
        body: declared.currentSchedule,
        schedule: true,
      },
    ]);
    vi.stubGlobal("fetch", async (input: unknown, init: RequestInit) => {
      const next = table[state.calls.length],
        url = new URL(String(input));
      assert(next, "UNDECLARED_PREFLIGHT_HTTP");
      assert.equal(url.origin, "https://api.stripe.com");
      assert.equal(url.pathname + url.search, next.path);
      assert.equal(init.method, next.method);
      assert.equal(init.redirect, "error");
      assert.equal(
        new Headers(init.headers).get("stripe-version"),
        declared.apiVersion,
      );
      state.calls.push({ method: String(init.method), path: next.path });
      if (next.schedule) {
        await gates.hold("schedule");
        advance(declared.scheduleAt);
        state.scheduleReplies++;
      }
      return new Response(JSON.stringify(next.body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_SYNTHETIC_PREFLIGHT",
        },
      });
    });
    const { getStripeClient } = await import("../../../../helpers.js");
    const client = getStripeClient(
      "sk_test_SYNTHETIC_PREFLIGHT_NO_CREDENTIAL",
      declared.apiVersion,
      { singleAttempt: true },
    );
    const method = client.rawRequest;
    const delegate = Object.freeze({
      rawRequest(...args: unknown[]) {
        return Reflect.apply(method, client, args) as Promise<unknown>;
      },
    });
    const readonlyBody = {
      rawRequest(...args: unknown[]) {
        state.readonlyCalls++;
        assert.equal(args[0], "GET");
        return Reflect.apply(method, client, args) as Promise<unknown>;
      },
    };
    const readonlyDelegate =
      name === "method-retarget" ? readonlyBody : Object.freeze(readonlyBody);
    retargetReadMethod = () => {
      assert.equal(name, "method-retarget");
      assert.equal(++state.methodRetargets, 1);
      Object.defineProperty(readonlyDelegate, "rawRequest", {
        enumerable: true,
        configurable: true,
        writable: true,
        value() {
          state.readonlyCalls++;
          throw Error("RETARGETED_READ_CALLED");
        },
      });
    };
    const sink = Object.freeze({
      send(value: unknown, acknowledge: (value: unknown) => void) {
        OWNER.check();
        const record = data(value);
        state.records.push(record);
        acknowledge({ sequence: record.sequence, binding: record.binding });
      },
    });
    let slotTakes = 0;
    const initialOperation = Object.freeze({
      owner: OWNER,
      originAssociation: origin,
      slot: Object.freeze({
        takeOnce(owner: unknown) {
          assert.equal(owner, OWNER);
          assert.equal(++slotTakes, 1);
          return {
            rawAttachRequest: original.attachRequest,
            originalBundle: original.originalBundle,
          };
        },
      }),
      readPlan: initialPlan,
      delegate,
      sink,
    });
    const initialFrame = Object.freeze({
      owner: OWNER,
      operation: initialOperation,
      request,
      readPlan: initialPlan,
      delegate,
    });
    // Each TEST Source cell is filled once after actual initial terminal ACK, then read unchanged.
    let operation: object | null = null,
      configureFrame: object | null = null;
    const coverage = Object.freeze({
      originalEntry: entries.entry,
      coversPreflight(record: unknown, evidence: unknown, fresh: unknown) {
        state.coverage++;
        assert.deepEqual(record, expectedRecord);
        assert.deepEqual(evidence, expectedEvidence);
        assert.deepEqual(fresh, projected);
        return true;
      },
    });
    vi.doMock("../operations/sourceOperations.js", () => ({
      COMPILED_INITIAL_ENTRIES: Object.freeze([entries.entry]),
      COMPILED_RECOVERY_ENTRIES: Object.freeze([]),
      COMPILED_PREFLIGHT_ENTRIES: Object.freeze([coverage]),
      ORIGINAL_ORIGIN_ASSOCIATION: origin,
      loadFixedInitialOperation: () => initialOperation,
      loadInitialOwnedTransportSource: () => initialFrame,
      loadOwnedConfigureOperation() {
        state.operationLoads++;
        assert(operation);
        return operation;
      },
      loadConfigureOwnedReadTransportSource() {
        state.pairLoads++;
        assert(configureFrame);
        return configureFrame;
      },
    }));
    const { captureOwnedInitialAttachV2 } =
      await import("../operations/initialAttach.js");
    const initialOutput = data(await captureOwnedInitialAttachV2().invoke());
    assert.equal(
      initialOutput.status,
      "attach_acknowledged",
      "ACTUAL_INITIAL_ACK_PREREQUISITE",
    );
    assert.equal(state.records.length, 3);
    assert.equal(
      state.calls.filter((value) => value.method === "POST").length,
      1,
    );
    const acknowledgement = initialOutput.receipt;
    assert(acknowledgement && typeof acknowledgement === "object");
    assert.deepEqual(data(acknowledgement).providerSnapshot, declared.schedule);
    assert.deepEqual(data(acknowledgement).request, request);
    assert.deepEqual(data(state.records[2]!.data).receipt, acknowledgement);
    advance(declared.baseAt);
    const goodConfiguration = {
      preparation: original.attachRequest.preparation,
      attachReceipt: {
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
        providerSnapshot: declared.schedule,
      },
      freshSubscription: declared.baselineBundle.wireSubscription,
      targetPrice: declared.baselineBundle.wireTargetPrice,
      billingCustomer: declared.baselineBundle.wireBillingCustomer,
      schedule: declared.schedule,
      apiVersion: declared.apiVersion,
      observedAt: declared.configureAt,
      firstDispatchedAt: declared.configureAt,
      configureKey: declared.configureKey,
    };
    const projected =
      await actual.projectRenewalConfigurationV2(goodConfiguration);
    OWNER.check();
    assert.equal(
      projected.status,
      "projected_configure_request",
      "EXPANDED_NATIVE_C6_PREREQUISITE",
    );
    if (projected.status !== "projected_configure_request")
      throw Error("EXPANDED_NATIVE_C6_PREREQUISITE");
    const expectedRecord = deepFreeze({
      configuration: goodConfiguration,
      request: projected,
      attachReceipt: acknowledgement,
      originalBundle: original.originalBundle,
    });
    const expectedEvidence = deepFreeze({
      bundle: declared.baselineBundle,
      schedule: declared.schedule,
      observedAt: Math.floor(declared.scheduleAt / 1000),
    });
    let boundRecord: unknown = expectedRecord;
    if (name === "original-failure")
      boundRecord = {
        ...expectedRecord,
        configuration: {
          ...goodConfiguration,
          apiVersion: declared.originalAPI,
        },
        request: { ...projected, logicalBinding: declared.badRecordBinding },
      };
    if (name === "record-token")
      boundRecord = replaceRecordToken(expectedRecord, tokenIndex);
    // Restore the real pointer after TEST detached tampering of other DATA fields.
    if (name === "record-token" && tokenIndex < 5)
      boundRecord = { ...data(boundRecord), attachReceipt: acknowledgement };
    operation = Object.freeze({
      owner: name === "foreign-owner" ? Object.freeze({}) : OWNER,
      originAssociation: name === "foreign-origin" ? Object.freeze({}) : origin,
      originalEntry:
        name === "foreign-entry" ? Object.freeze({}) : entries.entry,
      preflightEntry:
        name === "foreign-preflight-entry"
          ? Object.freeze({ ...coverage })
          : coverage,
      actualAcknowledgement:
        name === "foreign-ack"
          ? structuredClone(acknowledgement)
          : acknowledgement,
      record: boundRecord,
      readTransport: readonlyDelegate,
    });
    if (name === "retired-proxy")
      operation = new Proxy(operation, {
        get() {
          state.tupleTraps++;
          throw Error("RETIRED_TUPLE_TRAP");
        },
        ownKeys() {
          state.tupleTraps++;
          throw Error("RETIRED_TUPLE_TRAP");
        },
        getOwnPropertyDescriptor() {
          state.tupleTraps++;
          throw Error("RETIRED_TUPLE_TRAP");
        },
        getPrototypeOf() {
          state.tupleTraps++;
          throw Error("RETIRED_TUPLE_TRAP");
        },
      });
    configureFrame = Object.freeze({
      owner: OWNER,
      operation: name === "foreign-pair" ? Object.freeze({}) : operation,
      readPlan: configurePlan,
      delegate:
        name === "foreign-delegate"
          ? Object.freeze({
              rawRequest() {
                state.readonlyCalls++;
                throw Error("FOREIGN_DELEGATE_CALLED");
              },
            })
          : readonlyDelegate,
    });
    const before = {
      GET: state.calls.filter((value) => value.method === "GET").length,
      POST: state.calls.filter((value) => value.method === "POST").length,
      records: state.records.length,
    };
    state.initialFinished = true;
    if (name === "retired-capture" || name === "retired-proxy") OWNER.retire();
    const beforeCapture = Object.freeze({
      samples: state.samples,
      operationLoads: state.operationLoads,
    });
    // Load the actual actor only after real initial ACK and expanded C6 prerequisites.
    const subject = await import("../preflight/configurePreflight.js");
    return {
      OWNER,
      declared,
      state,
      basis: originalBasis,
      expectedRecord,
      expectedEvidence,
      projected,
      initialOutput,
      acknowledgement,
      boundRecord,
      beforeCapture,
      capture: subject.captureOwnedConfigurePreflightV2,
      directOriginal: () =>
        actual.projectRenewalConfigurationV2(
          data(boundRecord).configuration as Configuration,
        ),
      gates,
      deltas: () => ({
        GET:
          state.calls.filter((value) => value.method === "GET").length -
          before.GET,
        POST:
          state.calls.filter((value) => value.method === "POST").length -
          before.POST,
        records: state.records.length - before.records,
      }),
      async cleanup() {
        await gates.cleanup();
        cleanPreflightMocks();
      },
    };
  } catch (error) {
    await gates.cleanup();
    cleanPreflightMocks();
    throw error;
  }
}

export type PreflightFixture = Awaited<
  ReturnType<typeof configurePreflightFixture>
>;
