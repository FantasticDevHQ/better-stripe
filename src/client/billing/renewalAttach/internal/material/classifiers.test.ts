import { afterEach, expect, it, vi } from "vitest";
import { configuration } from "../../../../../../tests/renewalAggregate/rawRetention.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "../../../renewalV2/index.js";

afterEach(() => {
  vi.doUnmock("../sourceBindings.js");
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture(strings = true) {
  const p: any = structuredClone(configuration().preparation);
  const couponReads: any[] = [],
    ids = new Map<string, number>();
  for (const source of [p.subscription, p.subscription.items.data[0]])
    for (const d of source.discounts) {
      const c = d.source.coupon;
      c.times_redeemed = 7;
      c.metadata = { declared: "SYNTHETIC_RETAINED_315", opaque: "keep" };
      c.future_native = { unknown: [null, 1.25, "ordinary"] };
      if (!ids.has(c.id)) {
        ids.set(c.id, couponReads.length);
        couponReads.push({
          couponId: c.id,
          wireCoupon: structuredClone(c),
          association: { resource: "coupon", ordinal: 4 + couponReads.length },
        });
      }
      if (strings) d.source.coupon = c.id;
    }
  p.subscription.opaque = { preserved: ["Sub", null] };
  p.targetPrice.opaque = { preserved: "Price" };
  p.billingCustomer.opaque = { preserved: "Customer" };
  const b: any = {
    wireSubscription: structuredClone(p.subscription),
    wireTargetPrice: structuredClone(p.targetPrice),
    wireBillingCustomer: structuredClone(p.billingCustomer),
    couponReads,
    derivedCouponJoins: null,
  };
  const rows = [
    b.wireSubscription.discounts,
    b.wireSubscription.items.data[0].discounts,
  ].map((list: any[]) =>
    list.map((d, index) => {
      const ref = d.source.coupon,
        id = typeof ref === "string" ? ref : ref.id,
        couponReadIndex = couponReads.findIndex((r) => r.couponId === id);
      return {
        index,
        discountId: d.id,
        originalCouponReference: structuredClone(ref),
        couponReadIndex,
        joinedDiscount: {
          ...structuredClone(d),
          source: {
            ...structuredClone(d.source),
            coupon: structuredClone(couponReads[couponReadIndex].wireCoupon),
          },
        },
      };
    }),
  );
  b.derivedCouponJoins = { subscription: rows[0], item: rows[1] };
  const attachRequest = {
    preparation: p,
    apiVersion: "2026-09-30.endive",
    attachKey: "attach:retained315",
    firstDispatchedAt: p.expected.periodStart + 1,
  };
  return { attachRequest, originalBundle: b };
}
async function live(strings = true) {
  vi.resetModules();
  const input = fixture(strings);
  const service = {
    clock: {
      basis: {
        startWallMs: 0,
        startNs: 0n,
        workEndWallMs: 0,
        workEndNs: 0n,
        endWallMs: 0,
        endNs: 0n,
      },
      sample: () => ({
        wallMs: input.attachRequest.firstDispatchedAt * 1000,
        ns: BigInt(input.attachRequest.firstDispatchedAt * 1000) * 1000000n,
      }),
      subscribeRetirement: () => () => {},
    },
    originalPolicy: { firstDispatchedAt: 0, periodStart: 0, periodEnd: 0 },
    originAssociation: Object.freeze({}),
  };
  const start = input.attachRequest.firstDispatchedAt * 1000;
  Object.assign(service.clock.basis, {
    startWallMs: start,
    startNs: BigInt(start) * 1000000n,
    workEndWallMs: start + 180000,
    workEndNs: BigInt(start + 180000) * 1000000n,
    endWallMs: start + 210000,
    endNs: BigInt(start + 210000) * 1000000n,
  });
  Object.assign(service.originalPolicy, {
    firstDispatchedAt: input.attachRequest.firstDispatchedAt,
    periodStart: input.attachRequest.preparation.expected.periodStart,
    periodEnd: input.attachRequest.preparation.expected.periodEnd,
  });
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => service,
  }));
  const { OWNER } = await import("../originalOwner.js");
  OWNER.check();
  const classifiers = await import("./classifiers.js");
  return { input, OWNER, classifiers, service };
}

it("classifies complete retained raw Coupon evidence with actual C1 and C2", async () => {
  const h = await live();
  const raw = h.input.attachRequest;
  const prepared = await prepareRenewalPriceReplacementV2(raw.preparation);
  h.OWNER.check();
  const request = await prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: raw.apiVersion,
    attachKey: raw.attachKey,
    firstDispatchedAt: raw.firstDispatchedAt,
  });
  h.OWNER.check();
  expect(request.payload).toEqual({
    from_subscription: raw.preparation.expected.subscriptionId,
  });
  const result = await h.classifiers.classifyOwnedRetainedInitialAttachment(
    h.input,
  );
  expect(result.status).toBe("classified");
});

function freshInput(h: Awaited<ReturnType<typeof live>>) {
  return {
    ...h.input,
    currentBundle: structuredClone(h.input.originalBundle),
    observedAt: h.input.attachRequest.firstDispatchedAt,
  };
}
function derive(b: any) {
  const lists = [
    b.wireSubscription.discounts,
    b.wireSubscription.items.data[0].discounts,
  ];
  const rows = lists.map((list: any[]) =>
    list.map((d, index) => {
      const ref = d.source.coupon,
        id = typeof ref === "string" ? ref : ref.id,
        couponReadIndex = b.couponReads.findIndex(
          (r: any) => r.couponId === id,
        );
      return {
        index,
        discountId: d.id,
        originalCouponReference: structuredClone(ref),
        couponReadIndex,
        joinedDiscount: {
          ...structuredClone(d),
          source: {
            ...structuredClone(d.source),
            coupon: structuredClone(b.couponReads[couponReadIndex].wireCoupon),
          },
        },
      };
    }),
  );
  b.derivedCouponJoins = { subscription: rows[0], item: rows[1] };
}
function realDigestCounter() {
  const subtle = globalThis.crypto.subtle,
    original = subtle.digest.bind(subtle);
  let count = 0;
  vi.spyOn(subtle, "digest").mockImplementation((algorithm, data) => {
    count++;
    return original(algorithm, data);
  });
  return () => count;
}
it.each([true, false])(
  "retained and fresh full material preserve same-form string=%s Coupon evidence",
  async (strings) => {
    const h = await live(strings),
      input = freshInput(h),
      before = structuredClone(input);
    const a = await h.classifiers.classifyOwnedRetainedInitialAttachment(
        h.input,
      ),
      result = await h.classifiers.classifyOwnedInitialAttachment(input);
    expect(a.status).toBe("classified");
    expect(result.status).toBe("classified");
    if (a.status !== "classified" || result.status !== "classified")
      throw Error("Expected actual material");
    expect(Object.keys(result.material)).toHaveLength(21);
    expect(result.material.rawSources).toEqual({
      attachRequest: input.attachRequest,
      intent: "initial",
      freshSubscription: input.currentBundle.wireSubscription,
      targetPrice: input.currentBundle.wireTargetPrice,
      billingCustomer: input.currentBundle.wireBillingCustomer,
      observedAt: input.observedAt,
    });
    expect(a.material.rawSources).toEqual({
      attachRequest: h.input.attachRequest,
      intent: "initial",
    });
    expect(result.material.stageEvidence).toEqual({
      actualFreshSubscription: input.currentBundle.wireSubscription,
    });
    expect(a.material.freshness).toBe("retained");
    expect(result.material.freshness).toBe("fresh");
    expect(
      result.material.subscriptionDiscounts[0].source.coupon.times_redeemed,
    ).toBe(7);
    expect(
      result.material.subscriptionDiscounts[0].source.coupon.future_native,
    ).toEqual({ unknown: [null, 1.25, "ordinary"] });
    expect(input).toEqual(before);
    expect(Object.isFrozen(result.material)).toBe(true);
    expect(result.material.completeRequest.logicalBinding).toBe(
      result.material.originalPrepared.requestIdentity.binding,
    );
    expect(result.material.completeRequest.requestIdentity.binding).toMatch(
      /^renewal-attach:v2:sha256:[0-9a-f]{64}$/,
    );
  },
);
it.each([
  "Sub",
  "Price",
  "Customer",
  "Couponcounter",
  "Couponunknown",
  "ordinal",
  "missingCoupon",
  "referenceForm",
  "derivedIndex",
  "schedule",
])("fresh refuses complete raw/lineage drift %s", async (kind) => {
  const h = await live(),
    input = freshInput(h),
    b = input.currentBundle;
  if (kind === "Sub") b.wireSubscription.opaque.preserved.push("drift");
  if (kind === "Price") b.wireTargetPrice.opaque.preserved = "drift";
  if (kind === "Customer") b.wireBillingCustomer.opaque.preserved = "drift";
  if (kind === "Couponcounter") {
    b.couponReads[0].wireCoupon.times_redeemed++;
    derive(b);
  }
  if (kind === "Couponunknown") {
    b.couponReads[0].wireCoupon.future_native.extra = true;
    derive(b);
  }
  if (kind === "ordinal") b.couponReads[0].association.ordinal++;
  if (kind === "missingCoupon") b.couponReads.pop();
  if (kind === "referenceForm") {
    b.wireSubscription.discounts[0].source.coupon = structuredClone(
      b.couponReads[0].wireCoupon,
    );
    derive(b);
  }
  if (kind === "derivedIndex")
    b.derivedCouponJoins.subscription[0].couponReadIndex = 1;
  if (kind === "schedule") b.wireSubscription.schedule = "sub_sched_unowned";
  expect(
    (await h.classifiers.classifyOwnedInitialAttachment(input)).status,
  ).toBe("unsupported");
});
it("retained needs historical full Coupon body, never a current replacement", async () => {
  const h = await live();
  h.input.originalBundle.couponReads = [];
  expect(
    (await h.classifiers.classifyOwnedRetainedInitialAttachment(h.input))
      .status,
  ).toBe("unsupported");
});
it("complete typed discount applicability is still checked after coherent lineage", async () => {
  const h = await live(),
    input = freshInput(h);
  for (const b of [input.originalBundle, input.currentBundle]) {
    b.couponReads[0].wireCoupon.applies_to.products = [
      input.attachRequest.preparation.expected.currentProductId,
    ];
    derive(b);
  }
  expect(
    (await h.classifiers.classifyOwnedInitialAttachment(input)).status,
  ).toBe("unsupported");
});
it.each(["__proto__", "constructor", "prototype"])(
  "retains safe own %s, order, null and repeated ordinary references",
  async (key) => {
    const h = await live();
    const shared = { safe: [null, 1.25] };
    for (const b of [
      h.input.attachRequest.preparation.subscription,
      h.input.originalBundle.wireSubscription,
    ])
      Object.defineProperty(b, key, {
        value: { left: shared, right: shared },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    const input = freshInput(h),
      result = await h.classifiers.classifyOwnedInitialAttachment(input);
    expect(result.status).toBe("classified");
    if (result.status !== "classified") throw Error("Expected material");
    expect(
      Object.prototype.hasOwnProperty.call(
        result.material.originalPrepared.providerSnapshot.subscription,
        key,
      ),
    ).toBe(true);
    expect(
      (result.material.originalPrepared.providerSnapshot.subscription as any)[
        key
      ],
    ).toEqual({ left: shared, right: shared });
  },
);
it.each([
  "get",
  "has",
  "getPrototypeOf",
  "ownKeys",
  "getOwnPropertyDescriptor",
])("rejects raw Proxy before %s trap or hash", async (name) => {
  const h = await live();
  let traps = 0;
  const digest = realDigestCounter();
  const raw = new Proxy(h.input, {
    [name]() {
      traps++;
      throw Error("raw trap");
    },
  });
  expect(
    (await h.classifiers.classifyOwnedRetainedInitialAttachment(raw)).status,
  ).toBe("unsupported");
  expect(traps).toBe(0);
  expect(digest()).toBe(0);
});
it("rejects accessors, unknown caller proof, secret-name empty strings and cycles before hash", async () => {
  const h = await live(),
    digest = realDigestCounter();
  const accessor = Object.defineProperty({}, "attachRequest", {
    get() {
      throw Error("raw getter");
    },
    enumerable: true,
  });
  const cyclic: any = structuredClone(h.input);
  cyclic.originalBundle.wireSubscription.cycle = cyclic;
  const secret: any = structuredClone(h.input);
  secret.attachRequest.preparation.subscription.client_secret = "";
  for (const raw of [accessor, { ...h.input, proof: true }, secret, cyclic])
    expect(
      (await h.classifiers.classifyOwnedRetainedInitialAttachment(raw)).status,
    ).toBe("unsupported");
  expect(digest()).toBe(0);
});
it("dead original owner stops before input reflection and crypto", async () => {
  const h = await live(),
    digest = realDigestCounter();
  let traps = 0;
  const raw = new Proxy(
    {},
    {
      getPrototypeOf() {
        traps++;
        return Object.prototype;
      },
    },
  );
  h.OWNER.retire();
  expect(
    (await h.classifiers.classifyOwnedRetainedInitialAttachment(raw)).status,
  ).toBe("unsupported");
  expect(traps).toBe(0);
  expect(digest()).toBe(0);
});
it.each([1, 3])(
  "retirement at actual digest %s prevents later constructor/publication",
  async (at) => {
    const h = await live(),
      subtle = globalThis.crypto.subtle,
      real = subtle.digest.bind(subtle);
    let calls = 0,
      release!: () => void,
      entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      entry = new Promise<void>((r) => (entered = r));
    vi.spyOn(subtle, "digest").mockImplementation(async (algorithm, data) => {
      calls++;
      if (calls === at) {
        entered();
        await gate;
      }
      return real(algorithm, data);
    });
    let settled = false;
    const pending = h.classifiers
      .classifyOwnedRetainedInitialAttachment(h.input)
      .then((value) => {
        settled = true;
        return value;
      });
    try {
      const reached = await Promise.race([
        entry.then(() => true),
        pending.then(() => false),
      ]);
      expect(reached).toBe(true);
      expect(settled).toBe(false);
      h.OWNER.retire();
      release();
      expect((await pending).status).toBe("unsupported");
      expect(calls).toBe(at);
    } finally {
      release();
      await pending;
    }
  },
);
it("whole generated output limit refuses without trimming admitted input", async () => {
  const h = await live();
  for (const b of [
    h.input.attachRequest.preparation.subscription,
    h.input.originalBundle.wireSubscription,
  ])
    b.outputPadding = "x".repeat(100000);
  const input = freshInput(h),
    snapshot = structuredClone(input),
    digest = realDigestCounter();
  expect(JSON.stringify(input).length).toBeLessThan(500000);
  expect(
    (await h.classifiers.classifyOwnedInitialAttachment(input)).status,
  ).toBe("unsupported");
  expect(digest()).toBeGreaterThan(0);
  expect(input).toEqual(snapshot);
});
it("private scalar, UTF8, node and depth bounds remain fail closed", async () => {
  const { requiredJSONSnapshot } = await import("./requiredJson.js");
  expect(() => requiredJSONSnapshot("é".repeat(250001))).toThrow();
  expect(() =>
    requiredJSONSnapshot(Array.from({ length: 10000 }, () => null)),
  ).toThrow();
  let deep: any = null;
  for (let i = 0; i < 41; i++) deep = { next: deep };
  expect(() => requiredJSONSnapshot(deep)).toThrow();
  expect(() => requiredJSONSnapshot(Infinity)).toThrow();
  expect(() => requiredJSONSnapshot(Number.MAX_SAFE_INTEGER + 1)).toThrow();
});
it("canonical private node encoding keeps numeric indices and own special keys", async () => {
  const k = await import("./nodeKernel.js");
  const text = k.encode(
    k.objectNode([
      ["10", k.scalarNode("ten")],
      ["2", k.scalarNode("two")],
      ["__proto__", k.scalarNode(null)],
      ["a", k.scalarNode(-0)],
    ]),
  );
  expect(text).toBe('{"2":"two","10":"ten","__proto__":null,"a":0}');
  expect(
    Object.prototype.hasOwnProperty.call(
      k.materialize(
        k.objectNode([["__proto__", k.scalarNode("safe")]]),
      ) as object,
      "__proto__",
    ),
  ).toBe(true);
});

it("normal unbound Source rejects before raw input or crypto and registry stays empty", async () => {
  vi.doUnmock("../sourceBindings.js");
  vi.resetModules();
  const bindings = await import("../sourceBindings.js");
  expect(bindings.COMPILED_ENTRIES).toEqual([]);
  const c = await import("./classifiers.js");
  let traps = 0;
  const raw = new Proxy(
      {},
      {
        getPrototypeOf() {
          traps++;
          return Object.prototype;
        },
      },
    ),
    digest = realDigestCounter();
  expect((await c.classifyOwnedRetainedInitialAttachment(raw)).status).toBe(
    "unsupported",
  );
  expect((await c.classifyOwnedInitialAttachment(raw)).status).toBe(
    "unsupported",
  );
  expect(traps).toBe(0);
  expect(digest()).toBe(0);
});
