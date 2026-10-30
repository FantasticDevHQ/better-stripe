import { OWNER } from "../originalOwner.js";
import {
  prepareRenewalPriceReplacementV2 as c1,
  prepareRenewalScheduleAttachmentV2 as c2,
} from "../../../renewalV2/index.js";
import {
  captureRetainedInput,
  captureOwnedInput,
  ownedRetainedEligibility,
  ownedCouponEligibility,
  type RetainedInput,
  type FreshInput,
} from "./capture.js";
import { validateOwnedReadMaterial } from "./readMaterial.js";
import { requiredJSONSnapshot } from "./requiredJson.js";
import {
  objectNode,
  scalarNode,
  encode,
  materialize,
  need,
  freeze,
  type Node,
} from "./nodeKernel.js";
type Prepared = Awaited<ReturnType<typeof c1>>;
type Request = Awaited<ReturnType<typeof c2>>;
type Reads = ReturnType<typeof validateOwnedReadMaterial>;
type Args = {
  attachRequest: RetainedInput["attachRequest"];
  intent: "initial";
  freshSubscription?: unknown;
  targetPrice?: unknown;
  billingCustomer?: unknown;
  observedAt?: number;
};
function material(
  args: Args,
  fresh: boolean,
  prepared: Prepared,
  request: Request,
  reads: Reads,
  evidence: { actualFreshSubscription: unknown },
) {
  return {
    classificationRevision: "renewal-material-v2",
    protocolRevision: "renewal-stage-protocol-v1",
    stage: "attach",
    intent: args.intent,
    scope: request.scope,
    apiVersion: request.apiVersion,
    profile: reads.profile,
    quantity: prepared.quantity,
    currentPrice: reads.item.price,
    targetPrice: reads.targetPrice,
    source: reads.subscription,
    nativeItem: reads.item,
    billingCustomer: reads.customer,
    subscriptionDiscounts: reads.discounts,
    itemDiscounts: reads.itemDiscounts,
    settings: reads.originalSettings,
    originalPrepared: prepared,
    completeRequest: request,
    stageEvidence: evidence,
    rawSources: args,
    freshness: fresh ? "fresh" : "retained",
  };
}
type InitialMaterial = ReturnType<typeof material>;
type Classified = {
  status: "classified";
  kind: "RENEWAL_MATERIAL_V2_DATA_CONSISTENCY_ONLY";
  material: InitialMaterial;
};
const RETAINED_STOP = Object.freeze({
  status: "unsupported" as const,
  code: "RETAINED_INITIAL_MATERIAL_STOP",
});
const FRESH_STOP = Object.freeze({
  status: "unsupported" as const,
  code: "RAW_COUPON_MATERIAL_STOP",
});
const PREFIX = "/material/";
// This lexical publication closure accepts only locally reconstructed values, never a caller handle.
function release(
  material: InitialMaterial,
  prepared: Prepared,
  request: Request,
): Classified {
  const slots = new Map([
    [
      PREFIX + "originalPrepared/requestIdentity/binding",
      prepared.requestIdentity.binding,
    ],
    [
      PREFIX + "completeRequest/logicalBinding",
      prepared.requestIdentity.binding,
    ],
    [
      PREFIX + "completeRequest/requestIdentity/binding",
      request.requestIdentity.binding,
    ],
  ]);
  need(slots.size === 3);
  let nodes = 0,
    raw = 0;
  const seen = new Set<object>(),
    found = new Set<string>();
  function walk(x: unknown, path: string, depth: number): Node {
    need(++nodes <= 10000 && depth <= 40);
    if (slots.has(path)) {
      need(
        typeof x === "string" &&
          x === slots.get(path) &&
          /^(?:renewal|renewal-attach|renewal-attach-receipt|renewal-baseline|renewal-defaults|renewal-configure):v2:sha256:[0-9a-f]{64}$/.test(
            x,
          ),
      );
      found.add(path);
      raw += x.length;
      need(raw <= 500000);
      return scalarNode(x);
    }
    if (x === null || typeof x !== "object") {
      requiredJSONSnapshot(x);
      if (typeof x === "string") raw += x.length;
      need(raw <= 500000);
      return scalarNode(x);
    }
    need(!seen.has(x));
    seen.add(x);
    const array = Array.isArray(x),
      keys = Reflect.ownKeys(x),
      entries: [string, Node][] = [];
    const proto = Object.getPrototypeOf(x);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    const length = array ? Object.getOwnPropertyDescriptor(x, "length") : null;
    if (array)
      need(
        length &&
          "value" in length &&
          Number.isSafeInteger(length.value) &&
          length.value <= 10000,
      );
    for (const key of keys) {
      need(typeof key === "string");
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(x, key);
      need(d && d.enumerable && "value" in d);
      requiredJSONSnapshot(key);
      requiredJSONSnapshot({ [key]: d.value === null ? null : true });
      raw += key.length;
      need(raw <= 500000);
      need(
        !array ||
          (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length!.value),
      );
      entries.push([key, walk(d.value, path + "/" + key, depth + 1)]);
    }
    seen.delete(x);
    if (array) {
      need(entries.length === length!.value);
      entries.sort(([a], [b]) => Number(a) - Number(b));
      return Object.freeze({
        kind: "array" as const,
        entries: Object.freeze(
          entries.map(
            Object.freeze as (
              entry: [string, Node],
            ) => Readonly<[string, Node]>,
          ),
        ),
      });
    }
    return objectNode(entries);
  }
  const node = walk(
    {
      status: "classified",
      kind: "RENEWAL_MATERIAL_V2_DATA_CONSISTENCY_ONLY",
      material,
    },
    "",
    0,
  );
  need(found.size === slots.size);
  encode(node);
  return freeze(materialize(node)) as Classified;
}
async function retained(value: RetainedInput) {
  const raw = value.attachRequest;
  OWNER.check();
  const prepared = await c1(raw.preparation);
  OWNER.check();
  OWNER.check();
  const request = await c2({
    prepared,
    apiVersion: raw.apiVersion,
    attachKey: raw.attachKey,
    firstDispatchedAt: raw.firstDispatchedAt,
  });
  OWNER.check();
  const discounts = ownedRetainedEligibility(value),
    args = { attachRequest: raw, intent: "initial" as const };
  const reads = validateOwnedReadMaterial(
    {
      apiVersion: raw.apiVersion,
      observedAt: raw.firstDispatchedAt,
      freshSubscription: raw.preparation.subscription,
      targetPrice: prepared.providerSnapshot.targetPrice,
      billingCustomer: prepared.providerSnapshot.billingCustomer,
    },
    prepared,
    undefined,
    discounts,
  );
  OWNER.check();
  const result = release(
    material(args, false, prepared, request, reads, {
      actualFreshSubscription: raw.preparation.subscription,
    }),
    prepared,
    request,
  );
  OWNER.check();
  return result;
}
async function fresh(value: FreshInput) {
  const raw = value.attachRequest;
  OWNER.check();
  const prepared = await c1(raw.preparation);
  OWNER.check();
  OWNER.check();
  const request = await c2({
    prepared,
    apiVersion: raw.apiVersion,
    attachKey: raw.attachKey,
    firstDispatchedAt: raw.firstDispatchedAt,
  });
  OWNER.check();
  const discounts = ownedCouponEligibility(value),
    b = value.currentBundle;
  const args = {
    attachRequest: raw,
    intent: "initial" as const,
    freshSubscription: b.wireSubscription,
    targetPrice: b.wireTargetPrice,
    billingCustomer: b.wireBillingCustomer,
    observedAt: value.observedAt,
  };
  const reads = validateOwnedReadMaterial(
    {
      apiVersion: raw.apiVersion,
      observedAt: value.observedAt,
      freshSubscription: b.wireSubscription,
      targetPrice: b.wireTargetPrice,
      billingCustomer: b.wireBillingCustomer,
    },
    prepared,
    undefined,
    discounts,
  );
  OWNER.check();
  const result = release(
    material(args, true, prepared, request, reads, {
      actualFreshSubscription: b.wireSubscription,
    }),
    prepared,
    request,
  );
  OWNER.check();
  return result;
}
/** Internal DATA consistency only; Source owner and acquisition provenance remain unbound. */
export function classifyOwnedRetainedInitialAttachment(
  raw: unknown,
): Promise<Classified | typeof RETAINED_STOP> {
  let value;
  try {
    OWNER.check();
    value = captureRetainedInput(raw);
    OWNER.check();
  } catch {
    return Promise.resolve(RETAINED_STOP);
  }
  return retained(value).catch(() => {
    try {
      OWNER.check();
    } catch {}
    return RETAINED_STOP;
  });
}
export function classifyOwnedInitialAttachment(
  raw: unknown,
): Promise<Classified | typeof FRESH_STOP> {
  let value;
  try {
    OWNER.check();
    value = captureOwnedInput(raw);
    OWNER.check();
  } catch {
    return Promise.resolve(FRESH_STOP);
  }
  return fresh(value).catch(() => {
    try {
      OWNER.check();
    } catch {}
    return FRESH_STOP;
  });
}
