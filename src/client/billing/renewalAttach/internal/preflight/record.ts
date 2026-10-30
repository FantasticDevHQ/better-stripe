import { types } from "node:util";
import { OWNER } from "../originalOwner.js";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import {
  objectNode,
  scalarNode,
  encode,
  materialize,
  need,
  freeze,
} from "../material/nodeKernel.js";
import type { Node } from "../material/nodeKernel.js";
import { controls, recordFamilies, outputFamilies } from "./grammar.js";
import type { Configuration } from "./grammar.js";
import type { Bundle } from "../material/capture.js";
export interface CapturedRecord {
  readonly node: Node;
  readonly slots: ReadonlyMap<string, string>;
}
export interface CapturedPreflightRecord {
  readonly captured: CapturedRecord;
  readonly configuration: Configuration;
  readonly originalBundle: Bundle;
}
const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
// Only lexical entry points below choose these TWO fixed path tables; no caller paths/families.
function capture(value: unknown, output: boolean): CapturedRecord {
  const families = output ? outputFamilies : recordFamilies,
    slots = new Map<string, string>(),
    active = new Set<object>();
  let nodes = 0,
    rawChars = 0;
  function walk(x: unknown, path: string, depth: number): Node {
    need(++nodes <= 10000 && depth <= 40 && !types.isProxy(x));
    if (Object.prototype.hasOwnProperty.call(families, path)) {
      need(
        typeof x === "string" &&
          new RegExp("^" + families[path] + ":v2:sha256:[0-9a-f]{64}$").test(x),
      );
      slots.set(path, x);
      rawChars += x.length;
      need(rawChars <= 500000);
      return scalarNode(x);
    }
    if (x === null || typeof x !== "object") {
      requiredJSONSnapshot(x);
      if (typeof x === "string") rawChars += x.length;
      need(rawChars <= 500000);
      return scalarNode(x);
    }
    need(!active.has(x));
    active.add(x);
    const array = Array.isArray(x),
      proto = Object.getPrototypeOf(x);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    const keys = Reflect.ownKeys(x);
    need(keys.length <= 10001);
    controls(x, path, output);
    const entries: [string, Node][] = [];
    const length = array ? Object.getOwnPropertyDescriptor(x, "length") : null;
    const count: unknown = length?.value;
    if (array)
      need(
        length &&
          "value" in length &&
          typeof count === "number" &&
          Number.isSafeInteger(count) &&
          count <= 10000,
      );
    for (const key of keys) {
      need(typeof key === "string");
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(x, key);
      need(d && d.enumerable && "value" in d);
      requiredJSONSnapshot(key);
      requiredJSONSnapshot({ [key]: d.value === null ? null : true });
      rawChars += key.length;
      need(rawChars <= 500000);
      need(
        !array ||
          (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < (count as number)),
      );
      entries.push([key, walk(d.value, path + "/" + pointer(key), depth + 1)]);
    }
    active.delete(x);
    if (array) {
      need(entries.length === count);
      entries.sort(([a], [b]) => Number(a) - Number(b));
      return Object.freeze({
        kind: "array" as const,
        entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
      });
    }
    return objectNode(entries);
  }
  const node = walk(value, "", 0);
  need(slots.size === Object.keys(families).length);
  encode(node);
  return Object.freeze({ node, slots });
}
const child = (node: Node, key: string): Node => {
  need(node.kind === "object");
  const row = node.entries.find(([k]) => k === key);
  need(row);
  return row[1];
};
export function capturePreflightRecord(raw: unknown): CapturedPreflightRecord {
  OWNER.check();
  const captured = capture(raw, false);
  const configuration = freeze(
      materialize(child(captured.node, "configuration")),
    ) as Configuration,
    originalBundle = freeze(
      materialize(child(captured.node, "originalBundle")),
    ) as Bundle;
  OWNER.check();
  return Object.freeze({ captured, configuration, originalBundle });
}

/** Package-private capture; release owns the same before/after Owner guards as the Source body. */
export function capturePreflightOutput(value: unknown): CapturedRecord {
  return capture(value, true);
}
