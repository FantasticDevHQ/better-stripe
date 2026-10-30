import { types } from "node:util";
import type { constructRenewalScheduleAttachmentReceiptV2 } from "../../../renewalV2/index.js";
import { closed } from "../operations/types.js";
import { equal } from "../../../renewalAggregate/shared.js";
import type { AttachRaw } from "../material/capture.js";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import {
  objectNode,
  scalarNode,
  encode,
  materialize,
  need,
  freeze,
  type Node,
} from "../material/nodeKernel.js";
import type {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "../../../renewalV2/index.js";
type Receipt = Awaited<
  ReturnType<typeof constructRenewalScheduleAttachmentReceiptV2>
>;
type Prepared = Awaited<ReturnType<typeof prepareRenewalPriceReplacementV2>>;
type Request = Awaited<ReturnType<typeof prepareRenewalScheduleAttachmentV2>>;
const PREFIX = "/material/";
/** Bounded DATA admission only; the caller retains its own record and Source relation. */
export function admitReplayMaterial<T>(
  material: T,
  prepared: Prepared,
  request: Request,
): {
  status: "classified";
  kind: "RENEWAL_MATERIAL_V2_DATA_CONSISTENCY_ONLY";
  material: T;
} {
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
  return freeze(materialize(node)) as {
    status: "classified";
    kind: "RENEWAL_MATERIAL_V2_DATA_CONSISTENCY_ONLY";
    material: T;
  };
}

/** Full replay DATA equality; no Source, Owner, class or record context is accepted. */
export function assertReplayMaterial(
  value: unknown,
  prepared: Prepared,
  request: Request,
  raw: AttachRaw,
  current: Readonly<{
    wireSubscription: Record<string, unknown>;
    wireTargetPrice: Record<string, unknown>;
    wireBillingCustomer: Record<string, unknown>;
  }>,
  originalSubscription: unknown,
  observedAt: number,
): void {
  const material = closed(value, [
    "classificationRevision",
    "protocolRevision",
    "stage",
    "intent",
    "scope",
    "apiVersion",
    "profile",
    "quantity",
    "currentPrice",
    "targetPrice",
    "source",
    "nativeItem",
    "billingCustomer",
    "subscriptionDiscounts",
    "itemDiscounts",
    "settings",
    "originalPrepared",
    "completeRequest",
    "stageEvidence",
    "rawSources",
    "freshness",
  ]);
  need(
    material.classificationRevision === "renewal-material-v2" &&
      material.protocolRevision === "renewal-stage-protocol-v1" &&
      material.stage === "attach" &&
      material.intent === "replay_unknown" &&
      material.freshness === "fresh" &&
      material.scope === request.scope &&
      material.apiVersion === request.apiVersion,
  );
  need(
    equal(material.originalPrepared, prepared) &&
      equal(material.completeRequest, request),
  );
  need(
    equal(material.rawSources, {
      attachRequest: raw,
      intent: "replay_unknown",
      freshSubscription: current.wireSubscription,
      targetPrice: current.wireTargetPrice,
      billingCustomer: current.wireBillingCustomer,
      observedAt: observedAt,
    }),
  );
  need(
    equal(material.stageEvidence, {
      actualFreshSubscription: current.wireSubscription,
      historicalOriginalSubscription: originalSubscription,
    }),
  );
}

/** Full initial ACK wrapper DATA admission before final Owner and quarantine discard. */
export function admitInitialOutput(
  receipt: Receipt,
  prepared: Prepared,
  request: Request,
) {
  const output = {
    status: "attach_acknowledged",
    operationalAuthority: false,
    receipt,
  };
  const slots = new Map([
      ["/receipt/logicalBinding", prepared.requestIdentity.binding],
      ["/receipt/request/logicalBinding", prepared.requestIdentity.binding],
      [
        "/receipt/request/requestIdentity/binding",
        request.requestIdentity.binding,
      ],
      ["/receipt/binding", receipt.binding],
    ]),
    found = new Set<string>(),
    active = new Set<object>();
  let nodes = 0,
    rawCharacters = 0;
  function walk(value: unknown, path: string, depth: number): Node {
    need(++nodes <= 10000 && depth <= 40 && !types.isProxy(value));
    if (slots.has(path)) {
      const expected = slots.get(path),
        family =
          path === "/receipt/binding"
            ? "renewal-attach-receipt"
            : path === "/receipt/request/requestIdentity/binding"
              ? "renewal-attach"
              : "renewal";
      need(
        value === expected &&
          typeof value === "string" &&
          new RegExp("^" + family + ":v2:sha256:[0-9a-f]{64}$").test(value),
      );
      rawCharacters += value.length;
      need(rawCharacters <= 500000);
      found.add(path);
      return scalarNode(value);
    }
    if (value === null || typeof value !== "object") {
      requiredJSONSnapshot(value);
      if (typeof value === "string") rawCharacters += value.length;
      need(rawCharacters <= 500000);
      return scalarNode(value);
    }
    need(!active.has(value));
    active.add(value);
    const array = Array.isArray(value),
      proto = Object.getPrototypeOf(value);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    const keys = Reflect.ownKeys(value),
      entries: [string, Node][] = [],
      length = array ? Object.getOwnPropertyDescriptor(value, "length") : null;
    if (array)
      need(
        length &&
          "value" in length &&
          Number.isSafeInteger(length.value) &&
          length.value >= 0 &&
          length.value <= 10000,
      );
    for (const key of keys) {
      need(typeof key === "string");
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      need(d && d.enumerable && "value" in d);
      requiredJSONSnapshot(key);
      requiredJSONSnapshot({ [key]: d.value === null ? null : true });
      rawCharacters += key.length;
      need(rawCharacters <= 500000);
      if (array)
        need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length!.value);
      entries.push([key, walk(d.value, path + "/" + key, depth + 1)]);
    }
    active.delete(value);
    if (array) {
      need(entries.length === length!.value);
      entries.sort(([a], [b]) => Number(a) - Number(b));
      return Object.freeze({
        kind: "array",
        entries: Object.freeze(entries.map((e) => Object.freeze(e))),
      });
    }
    return objectNode(entries);
  }
  const node = walk(output, "", 0);
  need(found.size === 4);
  encode(node);
  return freeze(materialize(node));
}
