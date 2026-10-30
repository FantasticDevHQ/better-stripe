export type Node =
  | { readonly kind: "scalar"; readonly value: unknown }
  | {
      readonly kind: "array" | "object";
      readonly entries: readonly (readonly [string, Node])[];
    };
export function stop(): never {
  throw Error("MATERIAL_V2_UNSUPPORTED");
}
export function need(value: unknown): asserts value {
  if (!value) stop();
}
export function freeze<T>(x: T): T {
  if (x && typeof x === "object") {
    for (const d of Object.values(Object.getOwnPropertyDescriptors(x)))
      if ("value" in d) freeze(d.value);
    Object.freeze(x);
  }
  return x;
}
export function closed(
  x: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  need(x && typeof x === "object" && !Array.isArray(x));
  const p = Object.getPrototypeOf(x);
  need(p === Object.prototype || p === null);
  const keys = Reflect.ownKeys(x);
  need(
    keys.every(
      (k) =>
        typeof k === "string" && (required.includes(k) || optional.includes(k)),
    ),
  );
  need(required.every((k) => keys.includes(k)));
  return Object.fromEntries(
    keys.map((k) => {
      const d = Object.getOwnPropertyDescriptor(x, k);
      need(d && d.enumerable && "value" in d);
      return [k, d.value];
    }),
  );
}
export const objectNode = (
  entries: readonly (readonly [string, Node])[],
): Node =>
  Object.freeze({
    kind: "object",
    entries: Object.freeze(entries.map((e) => Object.freeze(e))),
  });
export const scalarNode = (value: unknown): Node =>
  Object.freeze({ kind: "scalar", value });
function ordered(entries: readonly (readonly [string, Node])[]) {
  const index = (k: string) =>
    /^(0|[1-9][0-9]*)$/.test(k) && Number(k) <= 4294967294;
  return [...entries].sort(([a], [b]) => {
    const ai = index(a),
      bi = index(b);
    return ai && bi
      ? Number(a) - Number(b)
      : ai
        ? -1
        : bi
          ? 1
          : a < b
            ? -1
            : a > b
              ? 1
              : 0;
  });
}
/** Canonical bytes from private captured nodes only; every duplicate occurrence is charged. */
export function encode(node: Node): string {
  let nodes = 0,
    total = 0;
  function part(s: string) {
    total += s.length;
    if (total > 500000) stop();
    return s;
  }
  function walk(n: Node, depth: number): string {
    if (++nodes > 10000 || depth > 40) stop();
    if (n.kind === "scalar") return part(JSON.stringify(n.value)!);
    if (n.kind === "array")
      return (
        part("[") +
        n.entries
          .map(([, v], i) => (i ? part(",") : "") + walk(v, depth + 1))
          .join("") +
        part("]")
      );
    if (n.kind !== "object") stop();
    return (
      part("{") +
      ordered(n.entries)
        .map(
          ([k, v], i) =>
            (i ? part(",") : "") +
            part(JSON.stringify(k)) +
            part(":") +
            walk(v, depth + 1),
        )
        .join("") +
      part("}")
    );
  }
  const text = walk(node, 0);
  if (new TextEncoder().encode(text).byteLength > 500000) stop();
  return text;
}
export function materialize(node: Node): unknown {
  if (node.kind === "scalar") return node.value;
  if (node.kind === "array") return node.entries.map(([, v]) => materialize(v));
  return Object.fromEntries(
    ordered(node.entries).map(([k, v]) => [k, materialize(v)]),
  );
}
