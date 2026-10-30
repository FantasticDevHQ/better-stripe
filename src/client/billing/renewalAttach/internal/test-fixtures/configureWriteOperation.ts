import assert from "node:assert/strict";
import { vi } from "vitest";
import { declaredEntries } from "./attachEntries.js";
import {
  declarePreflightCase,
  deepFreeze,
  data,
} from "./configurePreflightControls.js";
import {
  preflightBarriers,
  installPreflightDigestBarrier,
  cleanPreflightMocks,
  preflightObservationState,
  installPreflightObservers,
} from "./configurePreflightBarriers.js";
import {
  declareConfigureWriteFamily,
  type WriteCase,
} from "./configureWriteDeclarations.js";
import {
  writeObservationState,
  installWriteAPIObservers,
} from "./configureWriteObservations.js";
import {
  configureWriteBarriers,
  installWriteDigestAccounting,
} from "./configureWriteBarriers.js";
import {
  declareExpectedReplay,
  configureWriteTestFamily,
  type ConfiguredWriteTestFamily,
} from "./configureWriteHistory.js";
import {
  assertFit,
  assertPreflightPositive,
} from "./configurePreflightAssertions.js";
import {
  establishWriteOracle,
  assertWriteTokenPreimages,
  logWritePrerequisites,
} from "./configureWriteAssertions.js";

/** Closed TEST Source. Real initial ACK is a prerequisite, never a fabricated receipt. */
export async function configureWriteFixture(mode: WriteCase = "ack") {
  const name = "positive" as const;
  const declarations = declareConfigureWriteFamily(mode);
  const write = declarations.control;
  const writeState = writeObservationState();
  const writeGates = configureWriteBarriers();
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
    const actual = await installPreflightObservers(
      state,
      OWNER,
      name,
      gates,
      () => advance(declared.laterAt),
      () => {
        throw Error("NO_RETARGET_IN_WRITER_PREREQUISITE");
      },
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
    const readonlyDelegate = Object.freeze({
      rawRequest(...args: unknown[]) {
        state.readonlyCalls++;
        assert.equal(args[0], "GET");
        return Reflect.apply(method, client, args) as Promise<unknown>;
      },
    });
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
    let family: ConfiguredWriteTestFamily | null = null;
    const writeCoverage = Object.freeze({
      originalEntry: entries.entry,
      coversConfigure(record: unknown, evidence: unknown, fresh: unknown) {
        assert(family);
        return family.covers(record, evidence, fresh, expectedEvidence);
      },
    });
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
      COMPILED_CONFIGURE_WRITE_ENTRIES: Object.freeze(
        mode === "empty" ? [] : [writeCoverage],
      ),
      loadFixedConfigureWriteOperation() {
        assert(family);
        return family.initialOperation();
      },
      loadConfigureWriteTransportSource() {
        assert(family);
        return family.initialFrame();
      },
      loadFixedConfigureReplayOperation() {
        assert(family);
        return family.replayOperation();
      },
      loadConfigureReplayTransportSource() {
        assert(family);
        return family.replayFrame();
      },
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
    const boundRecord = expectedRecord;
    operation = Object.freeze({
      owner: OWNER,
      originAssociation: origin,
      originalEntry: entries.entry,
      preflightEntry: coverage,
      actualAcknowledgement: acknowledgement,
      record: boundRecord,
      readTransport: readonlyDelegate,
    });
    configureFrame = Object.freeze({
      owner: OWNER,
      operation,
      readPlan: configurePlan,
      delegate: readonlyDelegate,
    });
    const before = {
      GET: state.calls.filter((value) => value.method === "GET").length,
      POST: state.calls.filter((value) => value.method === "POST").length,
      records: state.records.length,
    };
    state.initialFinished = true;
    const beforeCapture = Object.freeze({
      samples: state.samples,
      operationLoads: state.operationLoads,
    });
    // Load the actual actor only after real initial ACK and expanded C6 prerequisites.
    const subject = await import("../preflight/configurePreflight.js");
    const prerequisite = {
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
      directOriginal: () =>
        actual.projectRenewalConfigurationV2(goodConfiguration),
      beforeCapture,
      capture: subject.captureOwnedConfigurePreflightV2,
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
        await writeGates.cleanup();
        await gates.cleanup();
        vi.doUnmock("../c10/publicApi.js");
        cleanPreflightMocks();
      },
    };
    const preflightOutput = await prerequisite.capture().invoke();
    assertPreflightPositive(prerequisite, preflightOutput);
    assert.deepEqual(declared, write.baseline, "DECLARED_INPUT_PARITY");
    assertFit(expectedRecord);
    assertFit(preflightOutput);
    const beforeWrite = {
      calls: state.calls.length,
      records: state.records.length,
    };
    const active = await installWriteAPIObservers(
      () => family?.currentObservations() ?? writeState,
      writeGates,
    );
    installWriteDigestAccounting(writeGates);
    const writeDelegate = Object.freeze({
      rawRequest(...args: unknown[]) {
        const state = family?.currentObservations() ?? writeState;
        state.trace.push("delegate:" + String(args[0]));
        state.delegateArgs.push(args);
        const options = data(args[3]);
        assert.equal(options.apiVersion, write.baseline.apiVersion);
        assert.equal(options.maxNetworkRetries, 0);
        assert.equal(
          Object.prototype.hasOwnProperty.call(options, "stripeAccount"),
          false,
        );
        const promise = Reflect.apply(method, client, args) as Promise<unknown>;
        state.originalPromises.push(promise);
        writeGates.pending.push(
          promise.then(
            () => {},
            () => {},
          ),
        );
        return promise;
      },
    });
    family = await configureWriteTestFamily({
      declared: write,
      declarations,
      owner: OWNER,
      origin,
      entry: entries.entry,
      coverage: writeCoverage,
      record: expectedRecord,
      configuration: goodConfiguration,
      preflightOutput,
      acknowledgement,
      plan: configurePlan,
      delegate: writeDelegate,
      request: projected,
      firstState: writeState,
      gates: writeGates,
      advance,
    });
    const { rawReceipt, expectedReceipt, expectedACK } =
      await establishWriteOracle(
        active,
        OWNER,
        goodConfiguration,
        projected,
        write,
        expectedRecord,
      );
    assert.deepEqual(
      projected.payload,
      write.expectedPayload,
      "INDEPENDENT_COMPLETE_PAYLOAD_PREREQUISITE",
    );
    assertWriteTokenPreimages(prepared, expectedRecord, expectedReceipt);
    assert.equal(writeGates.activeDigests.size, 0);
    assert.equal(OWNER.basis, originalBasis);
    logWritePrerequisites({
      initialOutput,
      preflightOutput,
      expectedRecord,
      rawReceipt,
      expectedReceipt,
      expectedACK,
      request: projected,
      state: writeState,
    });
    writeState.phase = "writer";
    return {
      ...prerequisite,
      write,
      writeState,
      writeGates,
      beforeWrite,
      rawReceipt,
      expectedReceipt,
      expectedACK,
      replayDeclaration: declareExpectedReplay(projected),
      captureWriter: family.captureA,
      captureReplayB: family.captureB,
      captureReplayC: family.captureC,
      replayStates: Object.freeze({ B: family.states.B, C: family.states.C }),
    };
  } catch (error) {
    await writeGates.cleanup();
    await gates.cleanup();
    vi.doUnmock("../c10/publicApi.js");
    cleanPreflightMocks();
    throw error;
  }
}

export type ConfigureWriteFixture = Awaited<
  ReturnType<typeof configureWriteFixture>
>;
