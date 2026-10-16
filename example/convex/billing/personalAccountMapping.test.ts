import { afterEach, expect, it, vi } from "vitest";

import { stripe } from "../stripe/helpers.js";
import { requireOriginalPersonalAccount } from "./personalAccountMapping.js";

afterEach(() => vi.restoreAllMocks());
const mapping = {
  status: "unique",
  account: { userId: "server_owner", stripeAccountId: "acct_original" },
} as const;
it("checks the original server-routed account against the unique personal mapping", async () => {
  const read = vi
    .spyOn(stripe, "getPersonalAccountMapping")
    .mockResolvedValue(mapping as never);
  await expect(
    requireOriginalPersonalAccount(
      {} as never,
      "server_owner",
      "acct_original",
    ),
  ).resolves.toEqual(mapping.account);
  expect(read).toHaveBeenCalledWith({}, { userId: "server_owner" });
  await expect(
    requireOriginalPersonalAccount({} as never, "server_owner", "acct_other"),
  ).rejects.toThrow("Original personal account unavailable");
});
it.each([
  { status: "unavailable", reason: "ambiguous" },
  { status: "unavailable", reason: "closed" },
  {
    status: "unique",
    account: { userId: "foreign_owner", stripeAccountId: "acct_original" },
  },
  { ...mapping, account: { ...mapping.account, orgId: "" } },
])("rejects unavailable or foreign original scope %#", async (result) => {
  vi.spyOn(stripe, "getPersonalAccountMapping").mockResolvedValue(
    result as never,
  );
  await expect(
    requireOriginalPersonalAccount(
      {} as never,
      "server_owner",
      "acct_original",
    ),
  ).rejects.toThrow("Original personal account unavailable");
});
it("preserves component lookup errors without guessing a replacement account", async () => {
  const error = new Error("component unavailable");
  vi.spyOn(stripe, "getPersonalAccountMapping").mockRejectedValue(error);
  await expect(
    requireOriginalPersonalAccount(
      {} as never,
      "server_owner",
      "acct_original",
    ),
  ).rejects.toBe(error);
});
