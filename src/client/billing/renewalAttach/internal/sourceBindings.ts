/** Internal adoption defaults. No production Source capability is bound. */
export const COMPILED_ENTRIES: readonly never[] = Object.freeze([]);
export function loadOwnedOriginalSource(): unknown {
  throw new Error("ORIGINAL_OWNER_UNBOUND");
}
export function loadFixedStockClient(): unknown {
  throw new Error("STOCK_CLIENT_UNBOUND");
}
