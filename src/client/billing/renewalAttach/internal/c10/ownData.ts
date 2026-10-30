import type { CapturedNode } from "./eventCodec.js";
export function stop(): never {
  throw Error("C10_SOURCE_STOP");
}
export function need(x: unknown): asserts x {
  if (!x) stop();
}
export function freeze<T>(x: T): T {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
  return x;
}
export function closed(
  raw: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  need(raw && typeof raw === "object" && !Array.isArray(raw));
  const p = Object.getPrototypeOf(raw);
  need(p === Object.prototype || p === null);
  const keys = Reflect.ownKeys(raw);
  need(
    keys.every(
      (k) =>
        typeof k === "string" && (required.includes(k) || optional.includes(k)),
    ) && required.every((k) => keys.includes(k)),
  );
  const out = Object.create(null) as Record<string, unknown>;
  for (const k of keys) {
    need(typeof k === "string");
    const d = Object.getOwnPropertyDescriptor(raw, k);
    need(d && d.enumerable && Object.prototype.hasOwnProperty.call(d, "value"));
    out[k] = d.value;
  }
  return out;
}
export function equalNodes(a: CapturedNode, b: CapturedNode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "scalar") return b.kind === "scalar" && a.value === b.value;
  if (b.kind === "scalar" || a.entries.length !== b.entries.length)
    return false;
  const other = new Map(b.entries);
  return a.entries.every(
    ([k, v]) => other.has(k) && equalNodes(v, other.get(k)!),
  );
}
export function field(node: CapturedNode, key: string): CapturedNode {
  need(node.kind === "object");
  const pair = node.entries.find(([k]) => k === key);
  need(pair);
  return pair[1];
}
export function scalar(node: CapturedNode): unknown {
  need(node.kind === "scalar");
  return node.value;
}
export interface EventRecord {
  readonly sequence: number;
  readonly binding: string;
  readonly data: unknown;
}
export interface AppendOptions {
  readonly timeoutMs: number;
  readonly send: (
    record: Readonly<EventRecord>,
    ack: (value: unknown) => void,
  ) => unknown;
}
export function options(raw: unknown): AppendOptions {
  try {
    const x = closed(raw, ["send", "timeoutMs"]);
    need(
      typeof x.send === "function" &&
        typeof x.timeoutMs === "number" &&
        Number.isSafeInteger(x.timeoutMs) &&
        x.timeoutMs >= 1 &&
        x.timeoutMs <= 5000,
    );
    return x as unknown as AppendOptions;
  } catch {
    stop();
  }
}
type Wire = {
  scope: string;
  apiVersion: string;
  method: string;
  path: string;
  payload: unknown;
  key: string;
  firstDispatchedAt: number;
};
export const sevenWire = <T extends Wire>(r: T): Pick<T, keyof Wire> => ({
  scope: r.scope,
  apiVersion: r.apiVersion,
  method: r.method,
  path: r.path,
  payload: r.payload,
  key: r.key,
  firstDispatchedAt: r.firstDispatchedAt,
});
