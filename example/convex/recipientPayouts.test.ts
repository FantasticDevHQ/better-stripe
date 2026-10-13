// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const raw = vi.hoisted(() => ({
  balance: { retrieve: vi.fn() },
  payouts: { list: vi.fn() },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const modules = import.meta.glob("./**/*.*s");
beforeEach(() => {
  vi.resetAllMocks();
  raw.balance.retrieve.mockResolvedValue({
    available: [{ currency: "usd", amount: 12500 }],
    pending: [{ currency: "usd", amount: 3200 }],
  });
  raw.payouts.list.mockImplementation(async (params) => ({
    has_more: !params.status && !params.starting_after,
    data: params.status
      ? params.status === "pending"
        ? [
            {
              id: "po_next",
              amount: 5000,
              currency: "usd",
              status: "pending",
              arrival_date: 1791936000,
              created: 1791849600,
            },
          ]
        : []
      : [
          {
            id: params.starting_after ? "po_older" : "po_paid",
            amount: 9000,
            currency: "usd",
            status: "paid",
            arrival_date: 1791849600,
            created: 1791763200,
          },
        ],
  }));
});
for (const role of ["seller", "affiliate"] as const) {
  it(`loads ${role} balance, upcoming payouts, and paginated history from its own Stripe account`, async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        role,
        name: role,
        email: `${role}@example.com`,
        stripeAccountId: `acct_${role}`,
      }),
    );
    const page = await t.action(api.recipientPayouts.load, { userId });
    expect(page.balances).toEqual([
      { currency: "usd", available: 12500, pending: 3200 },
    ]);
    expect(page.upcoming[0]).toMatchObject({
      id: "po_next",
      amount: 5000,
      arrivalDate: 1791936000000,
    });
    expect(page.upcoming).toHaveLength(1);
    expect(page.payouts[0].id).toBe("po_paid");
    expect(page.nextCursor).toBe("po_paid");
    const older = await t.action(api.recipientPayouts.load, {
      userId,
      cursor: page.nextCursor!,
    });
    expect(older.payouts[0].id).toBe("po_older");
    expect(older.nextCursor).toBeNull();
    for (const [, options] of raw.payouts.list.mock.calls)
      expect(options.stripeAccount).toBe(`acct_${role}`);
    expect(raw.payouts.list).toHaveBeenCalledWith(
      expect.objectContaining({ starting_after: "po_paid" }),
      { stripeAccount: `acct_${role}` },
    );
  });
}
it("rejects customer access before making Stripe requests", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "customer",
      name: "Customer",
      email: "c@example.com",
      stripeAccountId: "acct_customer",
    }),
  );
  await expect(t.action(api.recipientPayouts.load, { userId })).rejects.toThrow(
    /seller or affiliate/,
  );
  expect(raw.balance.retrieve).not.toHaveBeenCalled();
});

it("never shows a paid payout as upcoming when Stripe returns a terminal row in a filtered list", async () => {
  raw.payouts.list.mockResolvedValue({
    has_more: false,
    data: [
      {
        id: "po_paid",
        amount: 9000,
        currency: "usd",
        status: "paid",
        arrival_date: 1791849600,
        created: 1791763200,
      },
    ],
  });
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "affiliate",
      name: "Affiliate",
      email: "a@example.com",
      stripeAccountId: "acct_affiliate",
    }),
  );
  const result = await t.action(api.recipientPayouts.load, { userId });
  expect(result.upcoming).toEqual([]);
  expect(result.payouts).toHaveLength(1);
});
