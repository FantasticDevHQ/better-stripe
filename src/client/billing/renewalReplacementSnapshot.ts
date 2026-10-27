/** A bounded JSON copy. Reject non-JSON values rather than silently dropping them. */
export function renewalSnapshot<T>(value: T): T {
  const seen = new Set<object>();
  let nodes = 0;
  let characters = 500_000;
  function charge(size: number) {
    characters -= size;
    if (characters < 0)
      throw new Error("Renewal snapshot exceeds its JSON size budget.");
  }
  function copy(item: unknown, depth: number): unknown {
    if (++nodes > 10_000 || depth > 40)
      throw new Error("Renewal snapshot exceeds its JSON traversal budget.");
    if (typeof item === "string") {
      charge(item.length);
      return item;
    }
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || item === null || seen.has(item))
      throw new Error("Renewal snapshot must contain finite JSON values.");
    if (
      !Array.isArray(item) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(item))
    )
      throw new Error("Renewal snapshot must contain plain JSON objects.");
    if (Array.isArray(item) && item.length > 10_000)
      throw new Error(
        "Renewal snapshot array is too large for its JSON budget.",
      );
    seen.add(item);
    const entries: [string, unknown][] = [];
    for (const key in item) {
      const entry = Object.getOwnPropertyDescriptor(item, key);
      if (!entry) continue;
      if (!("value" in entry))
        throw new Error("Renewal snapshot must contain JSON data properties.");
      if (entries.length >= 10_000)
        throw new Error(
          "Renewal snapshot object exceeds its JSON traversal budget.",
        );
      charge(key.length);
      entries.push([key, entry.value]);
    }
    if (
      Object.getOwnPropertySymbols(item).some(
        (key) => Object.getOwnPropertyDescriptor(item, key)?.enumerable,
      )
    )
      throw new Error("Renewal snapshot must contain JSON data properties.");
    let result: unknown;
    if (Array.isArray(item)) {
      if (
        entries.some(
          ([key]) =>
            !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length,
        )
      )
        throw new Error(
          "Renewal snapshot arrays must contain only JSON elements.",
        );
      result = Array.from({ length: item.length }, (_, index) => {
        const entry = Object.getOwnPropertyDescriptor(item, String(index));
        if (!entry || !("value" in entry))
          throw new Error(
            "Renewal snapshot must not contain sparse JSON arrays.",
          );
        return copy(entry.value, depth + 1);
      });
    } else {
      result = Object.fromEntries(
        entries
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, copy(entry, depth + 1)]),
      );
    }
    seen.delete(item);
    return result;
  }
  const normalized = copy(value, 0);
  const serialized = JSON.stringify(normalized);
  if (serialized.length > 500_000)
    throw new Error("Renewal snapshot is too large.");
  return JSON.parse(serialized) as T;
}
