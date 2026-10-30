import { captureRaw } from "./f11.mjs";
import { requiredJSONSnapshot } from "./f15.mjs";
import { objectNode, scalarNode, encode, materialize } from "./f14.mjs";
import { need, freeze, stop } from "./f17.mjs";
import {
  prepareRenewalPriceReplacementV2 as c1,
  prepareRenewalScheduleAttachmentV2 as c2,
  constructRenewalScheduleAttachmentReceiptV2 as c3,
  projectRenewalConfigurationV2 as c6,
  validateReadMaterial,
  equal,
  referenceId,
} from "./f16.mjs";
const PREFIX = "/material/";
// This lexical publication closure accepts only locally reconstructed values, never a caller handle.
function release(material, prepared, request, receipt) {
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
  if (material.stage === "configure") {
    need(
      receipt &&
        request.attachReceiptBinding === receipt.binding &&
        receipt.logicalBinding === prepared.requestIdentity.binding &&
        receipt.request.logicalBinding === prepared.requestIdentity.binding,
    );
    for (const [k, v] of [
      ["attachReceiptBinding", receipt.binding],
      ["baselineBinding", request.baselineBinding],
      ["defaultSettingsBinding", request.defaultSettingsBinding],
    ])
      slots.set(PREFIX + "completeRequest/" + k, v);
    for (const [k, v] of [
      ["logicalBinding", prepared.requestIdentity.binding],
      ["request/logicalBinding", prepared.requestIdentity.binding],
      [
        "request/requestIdentity/binding",
        receipt.request.requestIdentity.binding,
      ],
      ["binding", receipt.binding],
    ])
      slots.set(PREFIX + "stageEvidence/acknowledgedAttachReceipt/" + k, v);
  }
  need(slots.size === (material.stage === "configure" ? 10 : 3));
  let nodes = 0,
    raw = 0;
  const seen = new Set(),
    found = new Set();
  function walk(x, path, depth) {
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
      entries = [];
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
        !array || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length.value),
      );
      entries.push([key, walk(d.value, path + "/" + key, depth + 1)]);
    }
    seen.delete(x);
    if (array) {
      need(entries.length === length.value);
      entries.sort(([a], [b]) => Number(a) - Number(b));
      return Object.freeze({
        kind: "array",
        entries: Object.freeze(entries.map(Object.freeze)),
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
  return freeze(materialize(node));
}
function material(args, stage, fresh, prepared, request, reads, evidence) {
  return {
    classificationRevision: "renewal-material-v2",
    protocolRevision: "renewal-stage-protocol-v1",
    stage,
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
function rawResidual(original, actual) {
  const { schedule: before, ...oldBody } = original,
    { schedule: after, ...currentBody } = actual;
  need(before === null && equal(oldBody, currentBody));
  return after;
}
function rawCounterparts(preparation, selected) {
  need(
    equal(preparation.targetPrice, selected.targetPrice) &&
      equal(preparation.billingCustomer, selected.billingCustomer),
  );
}
async function attach(args, fresh) {
  const raw = args.attachRequest,
    prepared = await c1(raw.preparation),
    request = await c2({
      prepared,
      apiVersion: raw.apiVersion,
      attachKey: raw.attachKey,
      firstDispatchedAt: raw.firstDispatchedAt,
    });
  const original = raw.preparation.subscription,
    actual = fresh ? args.freshSubscription : raw.preparation.subscription;
  rawResidual(raw.preparation.subscription, actual);
  rawCounterparts(raw.preparation, {
    targetPrice: fresh ? args.targetPrice : raw.preparation.targetPrice,
    billingCustomer: fresh
      ? args.billingCustomer
      : raw.preparation.billingCustomer,
  });
  let eligibility = actual,
    evidence = { actualFreshSubscription: actual };
  if (fresh && args.intent === "replay_unknown") {
    const afterSchedule = actual.schedule; // rawResidual already compared complete captured raw exactly once.
    if (afterSchedule !== null)
      referenceId(afterSchedule, "sub_sched", "subscription_schedule", {
        customerAccountId: prepared.expected.customerAccountId,
        livemode: prepared.expected.livemode,
      });
    eligibility = original;
    evidence = {
      actualAssociation: afterSchedule,
      actualFreshSubscription: actual,
    };
  }
  const reads = validateReadMaterial(
    {
      apiVersion: raw.apiVersion,
      observedAt: fresh ? args.observedAt : raw.firstDispatchedAt,
      freshSubscription: eligibility,
      targetPrice: fresh
        ? args.targetPrice
        : prepared.providerSnapshot.targetPrice,
      billingCustomer: fresh
        ? args.billingCustomer
        : prepared.providerSnapshot.billingCustomer,
    },
    prepared,
  );
  return release(
    material(args, "attach", fresh, prepared, request, reads, evidence),
    prepared,
    request,
  );
}
async function configure(args, fresh) {
  const original = args.configuration;
  // NO classifier repeated-preparation/identity/time semantic checks precede this public call.
  const desired = await c6(original);
  if (desired.status !== "projected_configure_request") return desired;
  rawCounterparts(original.preparation, original); // Original full raw counterparts cannot be hidden by a selected fresh restoration.
  const selected = fresh
    ? {
        ...original,
        freshSubscription: args.freshSubscription,
        targetPrice: args.targetPrice,
        billingCustomer: args.billingCustomer,
        schedule: args.schedule,
        observedAt: args.observedAt,
      }
    : original;
  if (fresh) {
    const current = await c6(selected);
    if (current.status !== "projected_configure_request") return current;
    need(equal(current, desired));
  }
  rawResidual(original.preparation.subscription, selected.freshSubscription);
  rawCounterparts(original.preparation, selected);
  need(equal(selected.schedule, original.attachReceipt.providerSnapshot));
  if (fresh)
    need(
      equal(selected.freshSubscription, original.freshSubscription) &&
        equal(selected.schedule, original.schedule),
    );
  const prepared = await c1(original.preparation),
    receipt = await c3(original.attachReceipt);
  need(
    desired.logicalBinding === prepared.requestIdentity.binding &&
      desired.attachReceiptBinding === receipt.binding,
  );
  const reads = validateReadMaterial(selected, prepared, receipt.scheduleId);
  const evidence = {
    fullProjectionInput: selected,
    acknowledgedAttachReceipt: receipt,
    actualSchedule: selected.schedule,
    completeDesiredPayload: desired.payload,
  };
  return release(
    material(args, "configure", fresh, prepared, desired, reads, evidence),
    prepared,
    desired,
    receipt,
  );
}
function classify(value, stage, fresh) {
  let args;
  try {
    args = captureRaw(value, stage, fresh);
  } catch {
    return Promise.reject(Error("MATERIAL_V2_UNSUPPORTED"));
  }
  return (
    stage === "attach" ? attach(args, fresh) : configure(args, fresh)
  ).catch(() => stop());
}
export const classifyRetainedAttachmentV2 = (value) =>
  classify(value, "attach", false);
export const classifyFreshAttachmentV2 = (value) =>
  classify(value, "attach", true);
export const classifyRetainedConfigurationV2 = (value) =>
  classify(value, "configure", false);
export const classifyFreshConfigurationV2 = (value) =>
  classify(value, "configure", true);
