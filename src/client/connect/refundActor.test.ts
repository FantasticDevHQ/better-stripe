/**
 * Tests for the refund authorization helper (BTS-35). The app supplies the
 * actor identity; the library decides who may refund what. A platform admin is
 * unrestricted; a seller may refund only sales routed to their own connected
 * account — as the destination-charge seller, or as the `store` leg of a split
 * (`separate`-charge) sale. Minor split legs (`affiliate` / `other`) are NOT
 * authorized: they'd otherwise be able to refund the whole buyer charge and
 * trigger pro-rata clawback from every recipient (the store included).
 */
import { describe, expect, it } from "vitest";

import { isRefundAuthorized } from "./refundActor.js";

describe("isRefundAuthorized (BTS-35)", () => {
  it("allows a platform admin to refund any sale", () => {
    expect(
      isRefundAuthorized(
        { type: "admin" },
        { destinationAccountId: "acct_someone_else" },
      ),
    ).toBe(true);
  });

  it("allows an admin even when the payment has no routing at all", () => {
    expect(isRefundAuthorized({ type: "admin" }, {})).toBe(true);
  });

  it("allows a seller to refund a destination charge routed to their account", () => {
    expect(
      isRefundAuthorized(
        { type: "seller", accountId: "acct_seller" },
        { destinationAccountId: "acct_seller" },
      ),
    ).toBe(true);
  });

  it("rejects a seller refunding another seller's destination charge", () => {
    expect(
      isRefundAuthorized(
        { type: "seller", accountId: "acct_seller" },
        { destinationAccountId: "acct_other" },
      ),
    ).toBe(false);
  });

  it("allows the store leg of a split sale to refund it", () => {
    expect(
      isRefundAuthorized(
        { type: "seller", accountId: "acct_store" },
        {
          splitRecipients: [
            { destinationAccountId: "acct_store", role: "store" },
            { destinationAccountId: "acct_affiliate", role: "affiliate" },
          ],
        },
      ),
    ).toBe(true);
  });

  it("rejects an affiliate leg refunding the whole split sale (admin-only)", () => {
    expect(
      isRefundAuthorized(
        { type: "seller", accountId: "acct_affiliate" },
        {
          splitRecipients: [
            { destinationAccountId: "acct_store", role: "store" },
            { destinationAccountId: "acct_affiliate", role: "affiliate" },
          ],
        },
      ),
    ).toBe(false);
  });

  it("rejects an `other` leg refunding the whole split sale (admin-only)", () => {
    expect(
      isRefundAuthorized(
        { type: "seller", accountId: "acct_other" },
        {
          splitRecipients: [
            { destinationAccountId: "acct_store", role: "store" },
            { destinationAccountId: "acct_other", role: "other" },
          ],
        },
      ),
    ).toBe(false);
  });

  it("lets an admin refund a split sale regardless of leg roles", () => {
    expect(
      isRefundAuthorized(
        { type: "admin" },
        {
          splitRecipients: [
            { destinationAccountId: "acct_store", role: "store" },
            { destinationAccountId: "acct_affiliate", role: "affiliate" },
          ],
        },
      ),
    ).toBe(true);
  });

  it("rejects a seller who is not a recipient of a split sale", () => {
    expect(
      isRefundAuthorized(
        { type: "seller", accountId: "acct_outsider" },
        {
          splitRecipients: [
            { destinationAccountId: "acct_store", role: "store" },
            { destinationAccountId: "acct_affiliate", role: "affiliate" },
          ],
        },
      ),
    ).toBe(false);
  });

  it("rejects a seller when the payment carries no routing to verify against", () => {
    expect(
      isRefundAuthorized({ type: "seller", accountId: "acct_seller" }, {}),
    ).toBe(false);
  });
});
