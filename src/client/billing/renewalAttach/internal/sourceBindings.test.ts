import { expect, it } from "vitest";
import {
  COMPILED_ENTRIES,
  loadOwnedOriginalSource,
  loadFixedStockClient,
} from "./sourceBindings.js";

it("keeps the registry empty and both Source capabilities unbound", () => {
  expect(COMPILED_ENTRIES).toEqual([]);
  expect(Object.isFrozen(COMPILED_ENTRIES)).toBe(true);
  expect(() => loadOwnedOriginalSource()).toThrow("ORIGINAL_OWNER_UNBOUND");
  expect(() => loadFixedStockClient()).toThrow("STOCK_CLIENT_UNBOUND");
});
