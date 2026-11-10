import { modules } from "../../test";
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../stripe/helpers", () => ({
  stripe: {
    createProduct: vi.fn(),
    getAccountByUserId: vi.fn(),
    getAccountByStripeId: vi.fn(),
  },
}));

import { api } from "../_generated/api";
import schema from "../schema";
import { stripe } from "../stripe/helpers";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(stripe.createProduct).mockResolvedValue({
    productId: null,
    stripeProductId: "prod_new",
  });
});

it("refuses product creation without a demo persona before calling Stripe", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.accounts.actions.createProductForAccount, {
      name: "Foreign product",
      accountId: "acct_foreign",
    } as never),
  ).rejects.toThrow();
  expect(stripe.createProduct).not.toHaveBeenCalled();
});

const productArgs = {
  userId: "seller",
  name: "Store product",
  description: "A product from this seller",
  accountId: "acct_store",
};

it("creates a product for the owning demo persona", async () => {
  vi.mocked(stripe.getAccountByUserId).mockResolvedValue({
    stripeAccountId: "acct_store",
  } as never);
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.accounts.actions.createProductForAccount, productArgs),
  ).resolves.toEqual({ productId: null, stripeProductId: "prod_new" });
  expect(stripe.createProduct).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    {
      name: productArgs.name,
      description: productArgs.description,
      accountId: "acct_store",
    },
  );
});

it("refuses a foreign account before product creation", async () => {
  vi.mocked(stripe.getAccountByUserId).mockResolvedValue({
    stripeAccountId: "acct_foreign",
  } as never);
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.accounts.actions.createProductForAccount, productArgs),
  ).rejects.toThrow("Account not found for this user");
  expect(stripe.createProduct).not.toHaveBeenCalled();
});

it("refuses a persona with no linked account", async () => {
  vi.mocked(stripe.getAccountByUserId).mockResolvedValue(null);
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.accounts.actions.createProductForAccount, productArgs),
  ).rejects.toThrow("Account not found for this user");
  expect(stripe.createProduct).not.toHaveBeenCalled();
});

it.each([
  { userId: "", accountId: "acct_store" },
  { userId: "   ", accountId: "acct_store" },
  { userId: "seller", accountId: "" },
  { userId: "seller", accountId: "   " },
])("refuses blank identity bindings %j", async (binding) => {
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.accounts.actions.createProductForAccount, {
      ...productArgs,
      ...binding,
    }),
  ).rejects.toThrow(/is required/);
  expect(stripe.createProduct).not.toHaveBeenCalled();
  expect(stripe.getAccountByUserId).not.toHaveBeenCalled();
});
