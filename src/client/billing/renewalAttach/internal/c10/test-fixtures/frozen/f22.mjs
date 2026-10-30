export { boundary, equal, freeze } from "./f23.mjs";
export const need = (x) => {
  if (!x) throw Error("PRE_T2_REQUEST_RELATIONS_UNSUPPORTED");
};
export const object = (x) => {
  need(x && typeof x === "object" && !Array.isArray(x));
  return x;
};
export const body = (rows, key) => object(rows[key].response.body);
export function id(value, prefix) {
  need(
    typeof value === "string" &&
      new RegExp("^" + prefix + "_[A-Za-z0-9]{1,100}$").test(value),
  );
  return value;
}
export const time = (value) => {
  need(Number.isSafeInteger(value) && value >= 0);
  return value;
};
export function item(sub) {
  need(
    sub.items && Array.isArray(sub.items.data) && sub.items.data.length === 1,
  );
  return object(sub.items.data[0]);
}
export function scalarPM(value) {
  return id(value, "pm");
}
