import { describe, expect, it } from "vitest";

import { resolveOwnerAccount } from "./owner.js";

describe("resolveOwnerAccount", () => {
  it("returns customer_account when present (V2 Accounts API)", () => {
    expect(
      resolveOwnerAccount({ customer_account: "acct_v2", customer: "cus_v1" }),
    ).toBe("acct_v2");
  });

  it("falls back to a string customer when no customer_account (V1)", () => {
    expect(
      resolveOwnerAccount({ customer_account: null, customer: "cus_v1" }),
    ).toBe("cus_v1");
  });

  it("falls back to customer.id for an expanded customer object", () => {
    expect(
      resolveOwnerAccount({ customer_account: null, customer: { id: "cus_x" } }),
    ).toBe("cus_x");
  });

  it("returns null when no owner info is present", () => {
    expect(
      resolveOwnerAccount({ customer_account: null, customer: null }),
    ).toBeNull();
  });

  it("returns null for an expanded customer object with no id", () => {
    expect(
      resolveOwnerAccount({ customer_account: null, customer: {} }),
    ).toBeNull();
  });
});
