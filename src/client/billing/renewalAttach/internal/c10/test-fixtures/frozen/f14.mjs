const fail = () => {
  throw Error("MATERIAL_V2_UNSUPPORTED");
};
export const objectNode = (entries) =>
  Object.freeze({
    kind: "object",
    entries: Object.freeze(entries.map((e) => Object.freeze(e))),
  });
export const scalarNode = (value) => Object.freeze({ kind: "scalar", value });
export const omit = (node, keys) => {
  if (node.kind !== "object") fail();
  return objectNode(node.entries.filter(([k]) => !keys.includes(k)));
};
function ordered(entries) {
  const index = (k) => /^(0|[1-9][0-9]*)$/.test(k) && Number(k) <= 4294967294;
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
/** Exact current canonical bytes from captured primitives only, never a live raw object. */
export function encode(node) {
  let nodes = 0,
    total = 0;
  function part(s) {
    total += s.length;
    if (total > 500000) fail();
    return s;
  }
  function walk(n, depth) {
    if (++nodes > 10000 || depth > 40) fail();
    if (n.kind === "scalar") return part(JSON.stringify(n.value));
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
/** Called only after every fixed incoming derived claim has been recomputed. */
export function materialize(node) {
  if (node.kind === "scalar") return node.value;
  if (node.kind === "array") return node.entries.map(([, v]) => materialize(v));
  return Object.fromEntries(
    ordered(node.entries).map(([k, v]) => [k, materialize(v)]),
  );
}
