export const stop = () => {
  throw Error("MATERIAL_V2_UNSUPPORTED");
};
export const need = (x) => {
  if (!x) stop();
};
export function freeze(x) {
  if (x && typeof x === "object") {
    for (const d of Object.values(Object.getOwnPropertyDescriptors(x)))
      if ("value" in d) freeze(d.value);
    Object.freeze(x);
  }
  return x;
}
export function closed(x, required, optional = []) {
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
