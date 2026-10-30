// TEST-only fixed dependency substitution. No runtime caller binding API.
import { vi } from "vitest";
import { createSourceRawAcquisition } from "../rawAcquisition.js";
const active = vi.hoisted(() => ({ owner: null, transport: null }));
vi.mock("../../originalOwner.js", () => ({
  OWNER: Object.freeze({
    get basis() {
      return active.owner.basis;
    },
    check() {
      return active.owner.sample();
    },
    sample() {
      return active.owner.sample();
    },
  }),
}));
vi.mock("../../stockRawDelegate.js", () => ({
  createSourceStockRawDelegate: () => active.transport,
}));
export function createTestOnlyRawAcquisition({ owner, transport }) {
  active.owner = owner;
  active.transport = transport;
  return createSourceRawAcquisition();
}
