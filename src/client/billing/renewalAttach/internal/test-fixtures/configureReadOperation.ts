import { expect, vi } from "vitest";
import type { RawReadTransport } from "../acquisition/rawWireSource.js";
import { makeConfigureReadNativeBaseline } from "./configureReadNativeBaseline.js";

type TraceEvent = { kind: string; child?: number; path?: string; at?: number };

/** All response bodies and test-clock cues are declared before subject constructors. */
export async function configureReadOperationFixture() {
  const baseline = makeConfigureReadNativeBaseline();
  const preparation = structuredClone(
    baseline.original.attachRequest.preparation,
  );
  const schedule = structuredClone(baseline.schedule);
  const currentSubscription = {
    ...structuredClone(preparation.subscription),
    schedule: schedule.id,
  };
  const expectedBundle = {
    ...structuredClone(baseline.original.originalBundle),
    wireSubscription: structuredClone(currentSubscription),
  };
  const query = String(
    new URLSearchParams(
      ["discounts", "items.data.discounts", "items.data.price"].map((x, i) => [
        "expand[" + i + "]",
        x,
      ]),
    ),
  );
  const paths = [
    "/v1/subscriptions/" + preparation.expected.subscriptionId + "?" + query,
    "/v1/prices/" + preparation.expected.targetPriceId,
    "/v1/customers/" + preparation.billingCustomer.id,
    ...expectedBundle.couponReads.map(
      (row) => "/v1/coupons/" + encodeURIComponent(row.couponId),
    ),
    "/v1/subscription_schedules/" + schedule.id,
  ];
  const rows = [
    { path: paths[0]!, body: currentSubscription },
    { path: paths[1]!, body: preparation.targetPrice },
    { path: paths[2]!, body: preparation.billingCustomer },
    ...expectedBundle.couponReads.map((row, i) => ({
      path: paths[3 + i]!,
      body: row.wireCoupon,
    })),
    { path: paths[paths.length - 1]!, body: schedule },
  ];
  const first = baseline.clockPlan.attachSeconds;
  const baseAt = baseline.clockPlan.observationSeconds * 1000 + 1001;
  const scheduleAt = baseline.clockPlan.observationSeconds * 1000 + 2001;
  const laterAt = baseline.clockPlan.observationSeconds * 1000 + 3001;
  const basis = Object.freeze({
    startWallMs: first * 1000,
    startNs: BigInt(first) * 1000000000n,
    workEndWallMs: (first + baseline.clockPlan.workSeconds) * 1000,
    workEndNs: BigInt(first + baseline.clockPlan.workSeconds) * 1000000000n,
    endWallMs: (first + baseline.clockPlan.endSeconds) * 1000,
    endNs: BigInt(first + baseline.clockPlan.endSeconds) * 1000000000n,
  });
  let now = baseAt;
  const events: TraceEvent[] = [];
  const clock = Object.freeze({
    basis,
    sample: () => ({ wallMs: now, ns: BigInt(now) * 1000000n }),
    subscribeRetirement: (_callback: () => void) => () => {},
  });
  const advance = (next: number) => {
    expect(next).toBeGreaterThanOrEqual(now);
    expect(next).toBeLessThan(basis.workEndWallMs);
    now = next;
  };
  const httpCalls: {
    url: string;
    method: string | undefined;
    redirect: RequestRedirect | undefined;
  }[] = [];
  const mechanics: {
    method: string;
    path: string;
    body: unknown;
    options: unknown;
  }[] = [];
  let children = 0;
  let begins = 0;
  let finishes = 0;
  let failures = 0;

  // Generated C1/C2/C3 DATA comes only from the actual maintained constructors.
  const api = await import("../../../renewalV2/index.js");
  const prepared = await api.prepareRenewalPriceReplacementV2(preparation);
  const request = await api.prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: baseline.apiVersion,
    attachKey: baseline.original.attachRequest.attachKey,
    firstDispatchedAt: first,
  });
  const receipt = await api.constructRenewalScheduleAttachmentReceiptV2({
    attachRequest: {
      ...structuredClone(baseline.original.attachRequest),
      preparation,
    },
    actualDispatch: {
      scope: request.scope,
      apiVersion: request.apiVersion,
      method: request.method,
      path: request.path,
      payload: request.payload,
      key: request.key,
      firstDispatchedAt: request.firstDispatchedAt,
    },
    providerSnapshot: structuredClone(schedule),
  });
  expect(receipt.scheduleId).toBe(schedule.id);
  expect(receipt.request).toEqual(request);
  expect(receipt.providerSnapshot).toEqual(schedule);
  // This receipt is pure constructor DATA. No POST, C10 ACK or Source custody exists here.

  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("stripe-version")).toBe(
        baseline.apiVersion,
      );
      const index = httpCalls.length;
      const row = rows[index];
      expect(row).toBeDefined();
      if (!row) throw Error("UNDECLARED_CONFIGURE_READ");
      expect(url).toBe("https://api.stripe.com" + row.path);
      httpCalls.push({ url, method: init?.method, redirect: init?.redirect });
      events.push({
        kind: "request",
        child: children,
        path: row.path,
        at: now,
      });
      if (row.path === paths[paths.length - 1]) advance(scheduleAt);
      const response = new Response(JSON.stringify(row.body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_SYNTHETIC_303_READONLY",
        },
      });
      events.push({ kind: "reply", child: children, path: row.path, at: now });
      return response;
    },
  );
  const { getStripeClient } = await import("../../../../helpers.js");
  const client = getStripeClient(
    "sk_test_SYNTHETIC_303_READONLY_NO_CREDENTIAL",
    baseline.apiVersion,
    { singleAttempt: true },
  );
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => ({
      clock,
      originalPolicy: {
        firstDispatchedAt: first,
        periodStart: preparation.expected.periodStart,
        periodEnd: preparation.expected.periodEnd,
      },
      originAssociation: Object.freeze({}),
    }),
    loadFixedStockClient: () => client,
  }));
  vi.doMock("../acquisition/readLifetime.js", async () => {
    const actual = await vi.importActual<
      typeof import("../acquisition/readLifetime.js")
    >("../acquisition/readLifetime.js");
    return {
      ...actual,
      createReadLifetime(
        owner: Parameters<typeof actual.createReadLifetime>[0],
      ) {
        expect(owner).toBe(OWNER);
        const createActual = actual.createReadLifetime;
        const child = createActual(owner);
        const id = ++children;
        events.push({ kind: "create", child: id, at: now });
        const begin = child.begin,
          check = child.check,
          finish = child.finish,
          fail = child.fail;
        return Object.freeze({
          begin(...args: Parameters<typeof begin>) {
            begins++;
            events.push({ kind: "begin", child: id, at: now });
            return Reflect.apply(begin, child, args) as ReturnType<
              typeof begin
            >;
          },
          check(...args: Parameters<typeof check>) {
            return Reflect.apply(check, child, args) as ReturnType<
              typeof check
            >;
          },
          finish(...args: Parameters<typeof finish>) {
            const result = Reflect.apply(finish, child, args) as ReturnType<
              typeof finish
            >;
            finishes++;
            events.push({ kind: "finish", child: id, at: result.wallMs });
            advance(laterAt);
            return result;
          },
          fail(...args: Parameters<typeof fail>) {
            failures++;
            events.push({ kind: "fail", child: id, at: now });
            return Reflect.apply(fail, child, args) as ReturnType<typeof fail>;
          },
        });
      },
    };
  });
  const { OWNER } = await import("../originalOwner.js");
  const { createSourceStockRawDelegate } =
    await import("../stockRawDelegate.js");
  const stock = createSourceStockRawDelegate();
  const rawRequest = stock.rawRequest;
  const transport: RawReadTransport = Object.freeze({
    rawRequest(...args: Parameters<RawReadTransport["rawRequest"]>) {
      const [method, path, body, options] = args;
      mechanics.push({ method, path, body, options: structuredClone(options) });
      return Reflect.apply(rawRequest, stock, args) as ReturnType<
        RawReadTransport["rawRequest"]
      >;
    },
  });
  const scope = Object.freeze({
    expected: Object.freeze(structuredClone(preparation.expected)),
    scheduleId: receipt.scheduleId,
  });
  return {
    OWNER,
    transport,
    scope,
    receipt,
    schedule,
    expectedBundle,
    paths,
    httpCalls,
    mechanics,
    events,
    baseAt,
    scheduleAt,
    laterAt,
    basis,
    counts: () => ({ children, begins, finishes, failures }),
  };
}

export function configureReadMetrics(value: unknown) {
  let nodes = 0,
    depth = 0;
  const active = new Set<object>();
  const walk = (x: unknown, d: number) => {
    nodes++;
    depth = Math.max(depth, d);
    if (x && typeof x === "object") {
      if (active.has(x)) throw Error("TEST_CYCLE");
      active.add(x);
      for (const y of Object.values(x)) walk(y, d + 1);
      active.delete(x);
    }
  };
  walk(value, 0);
  const text = JSON.stringify(value);
  return {
    chars: text.length,
    bytes: new TextEncoder().encode(text).length,
    nodes,
    depth,
  };
}
