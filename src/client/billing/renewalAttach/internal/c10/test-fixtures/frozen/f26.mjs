import schemas from "./f19.json" with { type: "json" };
export const TEST_LINE_INPUT = Object.freeze({ testOnlyLineInput: true });
export const fakeLine = (raw) =>
  raw === TEST_LINE_INPUT
    ? { ok: true, value: { testOnlyValidatedLineOutput: true } }
    : { ok: false };
function sample(schema) {
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1);
    if (name === "LinePage") return TEST_LINE_INPUT;
    return sample(schemas[name]);
  }
  if (schema.anyOf)
    return sample(
      schema.anyOf.find((s) => s.type === "null") ?? schema.anyOf[0],
    );
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.type === "null") return null;
  if (schema.type === "boolean") return false;
  if (schema.type === "integer")
    return schema.exclusiveMinimum === 0 ? 1 : Math.max(0, schema.minimum ?? 0);
  if (schema.type === "string") {
    const prefix = schema.pattern?.match(/\^([a-z]+)_/);
    if (prefix) return prefix[1] + "_SYNTHETIC";
    return schema.maxLength === 3 ? "usd" : "SYNTHETIC";
  }
  if (schema.type === "array") return [];
  if (schema.type === "object")
    return Object.fromEntries(
      (schema.required ?? []).map((key) => [
        key,
        sample(schema.properties[key]),
      ]),
    );
  throw Error("BAD_TEST_SCHEMA");
}
export const invoice = () => sample(schemas.PaidInvoice);
