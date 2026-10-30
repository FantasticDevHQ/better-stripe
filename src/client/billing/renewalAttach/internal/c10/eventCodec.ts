/** Private C10 canonical bytes; the public C1–C9 family table is unchanged. */
export type CapturedNode =
  | Readonly<{ kind: "scalar"; value: unknown }>
  | Readonly<{
      kind: "object" | "array";
      entries: readonly (readonly [string, CapturedNode])[];
    }>;
export type Entry = readonly [string, CapturedNode];
function fail(): never {
  throw Error("C10_SOURCE_STOP");
}
export const objectNode = (entries: readonly Entry[]): CapturedNode =>
  Object.freeze({
    kind: "object",
    entries: Object.freeze(entries.map((e) => Object.freeze(e))),
  });
export const scalarNode = (value: unknown): CapturedNode =>
  Object.freeze({ kind: "scalar", value });
export const omit = (node: CapturedNode, keys: readonly string[]) => {
  if (node.kind !== "object") fail();
  return objectNode(node.entries.filter(([k]) => !keys.includes(k)));
};
function ordered(entries: readonly Entry[]) {
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
export function encode(node: CapturedNode): string {
  let nodes = 0,
    total = 0;
  function part(s: string) {
    total += s.length;
    if (total > 500000) fail();
    return s;
  }
  function walk(n: CapturedNode, depth: number): string {
    if (++nodes > 10000 || depth > 40) fail();
    if (n.kind === "scalar") {
      const text = JSON.stringify(n.value);
      if (text === undefined) fail();
      return part(text);
    }
    if (n.kind === "array")
      return (
        part("[") +
        n.entries
          .map(([, v], i) => (i ? part(",") : "") + walk(v, depth + 1))
          .join("") +
        part("]")
      );
    if (n.kind !== "object") fail();
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
  if (new TextEncoder().encode(text).byteLength > 500000) fail();
  return text;
}
export function materialize(node: CapturedNode): unknown {
  if (node.kind === "scalar") return node.value;
  if (node.kind === "array") return node.entries.map(([, v]) => materialize(v));
  return Object.fromEntries(
    ordered(node.entries).map(([k, v]) => [k, materialize(v)]),
  );
}
function rawBound(node: CapturedNode) {
  let count = 0;
  function walk(n: CapturedNode) {
    if (n.kind === "scalar") {
      if (typeof n.value === "string") count += n.value.length;
    } else
      for (const [k, v] of n.entries) {
        count += k.length;
        walk(v);
      }
    if (count > 500000) fail();
  }
  walk(node);
}
export async function eventDigest(node: CapturedNode): Promise<string> {
  try {
    const tuple: CapturedNode = {
      kind: "array",
      entries: [
        ["0", scalarNode("betterstripe-renewal-binding")],
        ["1", scalarNode(2)],
        ["2", scalarNode("unbound-qualification-event")],
        ["3", node],
      ],
    };
    rawBound(tuple);
    const bytes = new TextEncoder().encode(encode(tuple)),
      subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== "function") fail();
    const result = await subtle.digest("SHA-256", bytes);
    if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) fail();
    return (
      "unbound-qualification-event:v2:sha256:" +
      Array.from(new Uint8Array(result), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("")
    );
  } catch {
    fail();
  }
}
