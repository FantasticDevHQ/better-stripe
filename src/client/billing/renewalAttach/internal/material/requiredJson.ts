// Private required-material prerequisite. No operator, PII or typed-field admission.
const STOP = "REQUIRED_JSON_PRIVACY_STOP";
const credentialNames = new Set([
  "clientsecret",
  "confirmationsecret",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "apikey",
  "secretkey",
  "adminkey",
  "privatekey",
  "stripesecretkey",
  "cardnumber",
  "creditcardnumber",
  "cvc",
  "cvv",
  "bankaccountnumber",
  "routingnumber",
  "iban",
  "accountnumber",
]);
const credentialText =
  /(?:sk|rk)_(?:test|live)_|whsec_|_secret_|\bBearer\s+|\bAuthorization\s*:|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|(?:^|\D)(?:\d[ -]?){12,18}\d(?:$|\D)/i;
const fail: () => never = () => {
  throw new Error(STOP);
};
// Counts JSON escaping without serializing or reading object properties.
function stringSize(text: string) {
  let bytes = 2,
    characters = 2;
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n === 34 || n === 92 || [8, 9, 10, 12, 13].includes(n)) {
      bytes += 2;
      characters += 2;
    } else if (n < 32) {
      bytes += 6;
      characters += 6;
    } else if (
      n >= 0xd800 &&
      n <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      characters += 2;
      i++;
    } else if (n >= 0xd800 && n <= 0xdfff) {
      bytes += 6;
      characters += 6;
    } else {
      bytes += n < 128 ? 1 : n < 2048 ? 2 : 3;
      characters++;
    }
  }
  return { bytes, characters };
}
export function requiredJSONSnapshot(value: unknown): unknown {
  try {
    let nodes = 0,
      rawCharacters = 0,
      jsonCharacters = 0,
      utf8Bytes = 0;
    const active = new Set<object>(),
      captures = new Map<
        object,
        { array: boolean; entries: [string, unknown][] }
      >();
    function charge(characters: number, bytes: number) {
      jsonCharacters += characters;
      utf8Bytes += bytes;
      if (jsonCharacters > 500000 || utf8Bytes > 500000) fail();
    }
    function string(text: string) {
      if (credentialText.test(text)) fail();
      rawCharacters += text.length;
      if (rawCharacters > 500000) fail();
      const size = stringSize(text);
      charge(size.characters, size.bytes);
    }
    function scan(item: unknown, depth: number) {
      if (++nodes > 10000 || depth > 40) fail();
      if (typeof item === "string") {
        string(item);
        return;
      }
      if (item === null) {
        charge(4, 4);
        return;
      }
      if (typeof item === "boolean") {
        charge(item ? 4 : 5, item ? 4 : 5);
        return;
      }
      if (typeof item === "number") {
        if (
          !Number.isFinite(item) ||
          (Number.isInteger(item) && !Number.isSafeInteger(item))
        )
          fail();
        const size = String(item).length;
        charge(size, size);
        return;
      }
      if (!item || typeof item !== "object" || active.has(item)) fail();
      const array = Array.isArray(item),
        proto = Object.getPrototypeOf(item);
      if (
        array
          ? proto !== Array.prototype
          : proto !== Object.prototype && proto !== null
      )
        fail();
      const keys = Reflect.ownKeys(item);
      if (keys.some((key) => typeof key !== "string")) fail();
      const length = array
        ? Object.getOwnPropertyDescriptor(item, "length")
        : null;
      if (
        array &&
        (!length ||
          !("value" in length) ||
          !Number.isSafeInteger(length.value) ||
          length.value > 10000)
      )
        fail();
      const entries: [string, unknown][] = [];
      for (const key of keys) {
        if (array && key === "length") continue;
        if (entries.length >= 10000) fail();
        if (
          array &&
          (!/^(0|[1-9][0-9]*)$/.test(key as string) ||
            Number(key) >= length!.value)
        )
          fail();
        // Secret names themselves are not secret values. Non-null values stop.
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          fail();
        if (
          credentialNames.has(
            (key as string).replace(/[^A-Za-z0-9]/g, "").toLowerCase(),
          ) &&
          descriptor.value !== null
        )
          fail();
        if (!array) string(key as string);
        else {
          rawCharacters += (key as string).length;
          if (rawCharacters > 500000) fail();
        }
        entries.push([key as string, descriptor.value]);
      }
      if (array && entries.length !== length!.value) fail();
      charge(
        2 + Math.max(0, entries.length - 1) + (array ? 0 : entries.length),
        2 + Math.max(0, entries.length - 1) + (array ? 0 : entries.length),
      );
      active.add(item);
      for (const [, child] of entries) scan(child, depth + 1);
      active.delete(item);
      // Internal descriptor capture only. No detached JSON clone exists until all scans pass.
      captures.set(item, { array, entries });
    }
    scan(value, 0);
    function copy(item: unknown): unknown {
      if (!item || typeof item !== "object") return item;
      const { array, entries } = captures.get(item)!;
      if (array) return entries.map(([, child]) => copy(child));
      return Object.fromEntries(
        entries
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, copy(child)]),
      );
    }
    return copy(value);
  } catch {
    fail();
  }
}
