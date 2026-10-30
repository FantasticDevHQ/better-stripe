import { types } from "node:util";
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
  constructRenewalScheduleAttachmentReceiptV2,
  prepareRenewalPriceReplacementV2,
} from "../../../renewalV2/index.js";
import type { AttachRequest } from "../operations/types.js";

type Receipt = Awaited<
  ReturnType<typeof constructRenewalScheduleAttachmentReceiptV2>
>;
type Prepared = Awaited<ReturnType<typeof prepareRenewalPriceReplacementV2>>;
/** Full result admission; caller must retain its own Source association and final Owner gate. */
export function admitRecoveryOutput(
  receipt: Receipt,
  observed: unknown,
  prepared: Prepared,
  request: AttachRequest,
) {
  need(!types.isProxy(observed));
  const observedID =
    typeof observed === "string"
      ? observed
      : (() => {
          need(observed !== null && typeof observed === "object");
          return Object.getOwnPropertyDescriptor(observed, "id")
            ?.value as unknown;
        })();
  const output = {
    kind: "EXPLICIT_ATTACH_RECOVERY_V2_DATA_ONLY",
    status: "attach_acknowledged",
    operationalAuthority: false,
    receipt,
    observation: {
      schedule: observed,
      conflict: observedID !== receipt.scheduleId,
      authority: "unowned_prepost_observation_only",
    },
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
