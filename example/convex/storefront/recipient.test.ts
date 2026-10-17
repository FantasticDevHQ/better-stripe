import { canReceiveTransfers } from "@fantastic.dev/better-stripe";
import { expect, it } from "vitest";
import { canReceiveStorePayments } from "./recipient";

it("uses the component transfer-capability contract for storefront eligibility", () => {
  expect(canReceiveStorePayments).toBe(canReceiveTransfers);
});
it.each([
  [null, false],
  [undefined, false],
  [{}, false],
  [{ capabilities: { transfers: "pending" } }, false],
  [{ capabilities: { transfers: "active" } }, true],
  [
    {
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { status: "active" } },
          },
        },
      },
    },
    true,
  ],
  [
    {
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { status: "pending" } },
          },
        },
      },
    },
    false,
  ],
] as const)("evaluates provider capability %j as %s", (account, expected) => {
  expect(canReceiveStorePayments(account)).toBe(expected);
});
