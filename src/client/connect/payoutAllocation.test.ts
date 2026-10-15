import { describe, expect, it } from "vitest";
import { planRecipientPayout } from "../../component/payoutRelease/allocation.js";

const source = (id: string, matureNet: number, extra = {}) => ({
  stripeTransferId: id,
  currency: "usd",
  matureNet,
  paidAmount: 0,
  reservedAmount: 0,
  pendingCredits: 0,
  role: "store" as const,
  ...extra,
});
const options = (
  sources = [
    source("tr_creator", 600),
    source("tr_affiliate", 400, { role: "affiliate" }),
  ],
) => ({
  currency: "usd",
  threshold: 1000,
  providerAvailable: 1000,
  independentLiabilities: 0,
  sources,
});

describe("combined recipient payout allocation", () => {
  it("qualifies creator and affiliate funds together at the exact threshold", () => {
    expect(planRecipientPayout(options())).toEqual({
      status: "qualified",
      currency: "usd",
      amount: 1000,
      matureUnpaid: 1000,
      pendingCredits: 0,
      providerMinimum: null,
      allocations: [
        { stripeTransferId: "tr_affiliate", amount: 400, role: "affiliate" },
        { stripeTransferId: "tr_creator", amount: 600, role: "store" },
      ],
    });
  });
  it("keeps the entire combined balance owed below the threshold", () => {
    expect(
      planRecipientPayout(options([source("tr_creator", 999)])),
    ).toMatchObject({
      status: "held",
      reason: "below_threshold",
      matureUnpaid: 999,
      amount: 0,
    });
  });
  it("releases the full eligible balance above the threshold", () => {
    expect(
      planRecipientPayout({
        ...options([source("tr_creator", 1200)]),
        providerAvailable: 1500,
      }),
    ).toMatchObject({
      status: "qualified",
      amount: 1200,
    });
  });
  it("cannot use unrelated available money to qualify a pending source", () => {
    expect(
      planRecipientPayout({
        ...options([source("tr_pending", 0, { pendingCredits: 1500 })]),
        providerAvailable: 10000,
      }),
    ).toMatchObject({
      status: "held",
      reason: "below_threshold",
      matureUnpaid: 0,
      pendingCredits: 1500,
    });
  });
  it("deducts previously paid and still reserved allocations exactly once", () => {
    expect(
      planRecipientPayout(
        options([
          source("tr_creator", 2500, { paidAmount: 800, reservedAmount: 700 }),
        ]),
      ),
    ).toMatchObject({
      status: "qualified",
      matureUnpaid: 1000,
      amount: 1000,
      allocations: [
        { stripeTransferId: "tr_creator", amount: 1000, role: "store" },
      ],
    });
  });
  it("carries a refunded paid source as debt against future funds", () => {
    expect(
      planRecipientPayout(
        options([
          source("tr_refunded", 0, { paidAmount: 600 }),
          source("tr_new", 1500, { role: "affiliate" }),
        ]),
      ),
    ).toMatchObject({
      status: "held",
      reason: "below_threshold",
      matureUnpaid: 900,
    });
    expect(
      planRecipientPayout(
        options([
          source("tr_refunded", 0, { paidAmount: 600 }),
          source("tr_new", 1600, { role: "affiliate" }),
        ]),
      ),
    ).toMatchObject({
      status: "qualified",
      amount: 1000,
      allocations: [
        { stripeTransferId: "tr_new", amount: 1000, role: "affiliate" },
      ],
    });
  });
  it("retains negative fee adjustments without forfeiting unpaid funds", () => {
    expect(
      planRecipientPayout(
        options([source("tr_fee", -30), source("tr_new", 1030)]),
      ),
    ).toMatchObject({
      status: "qualified",
      amount: 1000,
      allocations: [
        { stripeTransferId: "tr_new", amount: 1000, role: "store" },
      ],
    });
  });
  it("caps release by fresh provider availability after independent liabilities", () => {
    const result = planRecipientPayout({
      ...options([source("tr_creator", 2000)]),
      providerAvailable: 1500,
      independentLiabilities: 200,
    });
    expect(result).toMatchObject({
      status: "qualified",
      amount: 1300,
      matureUnpaid: 1800,
    });
    expect(
      planRecipientPayout({
        ...options(),
        providerAvailable: 1000,
        independentLiabilities: 1,
      }),
    ).toMatchObject({
      status: "held",
      reason: "below_threshold",
      matureUnpaid: 999,
    });
  });
  it("does not subtract reservations again from an already debited provider balance", () => {
    expect(
      planRecipientPayout({
        ...options([source("tr_creator", 2000, { reservedAmount: 1000 })]),
        providerAvailable: 1000,
      }),
    ).toMatchObject({ status: "qualified", amount: 1000 });
  });
  it("isolates currencies, including debts and pending credits", () => {
    expect(
      planRecipientPayout(
        options([
          source("tr_usd", 1000),
          source("tr_eur", -5000, { currency: "eur", pendingCredits: 300 }),
        ]),
      ),
    ).toMatchObject({ status: "qualified", amount: 1000, pendingCredits: 0 });
  });
  it("uses stable source ordering regardless of observation order", () => {
    const rows = [source("tr_z", 700), source("tr_a", 800)];
    const args = { ...options(rows), providerAvailable: 1100 };
    const first = planRecipientPayout(args);
    expect(first).toEqual(
      planRecipientPayout({ ...args, sources: [...rows].reverse() }),
    );
    expect(first).toMatchObject({
      allocations: [
        { stripeTransferId: "tr_a", amount: 800, role: "store" },
        { stripeTransferId: "tr_z", amount: 300, role: "store" },
      ],
    });
  });
  it("preserves signed debt even if there are no current credits", () => {
    expect(
      planRecipientPayout(
        options([source("tr_debt", -50, { paidAmount: 200 })]),
      ),
    ).toMatchObject({
      status: "held",
      matureUnpaid: -250,
      amount: 0,
    });
  });
  it("does not invent a numeric provider minimum", () => {
    expect(
      planRecipientPayout({
        ...options([source("tr_small", 1)]),
        threshold: 1,
      }),
    ).toMatchObject({
      status: "qualified",
      amount: 1,
      providerMinimum: null,
    });
  });
  it("rejects duplicate sources rather than counting them twice", () => {
    awaitInvalid(() =>
      planRecipientPayout(
        options([source("tr_same", 600), source("tr_same", 600)]),
      ),
    );
  });
  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    "rejects an unsafe threshold %s",
    (threshold) => {
      awaitInvalid(() => planRecipientPayout({ ...options(), threshold }));
    },
  );
  it.each(["USD", "us", "", "usd\n"])(
    "rejects malformed currency %s",
    (currency) => {
      awaitInvalid(() => planRecipientPayout({ ...options(), currency }));
    },
  );
  it.each(["paidAmount", "reservedAmount", "pendingCredits"] as const)(
    "rejects negative source %s",
    (field) => {
      awaitInvalid(() =>
        planRecipientPayout(options([source("tr_bad", 1000, { [field]: -1 })])),
      );
    },
  );
  it("checks every source, even an otherwise ignored currency", () => {
    awaitInvalid(() =>
      planRecipientPayout(
        options([
          source("tr_usd", 1000),
          source("tr_bad", 1.2, { currency: "eur" }),
        ]),
      ),
    );
  });
  it.each([NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe source money %s",
    (matureNet) => {
      awaitInvalid(() =>
        planRecipientPayout(options([source("tr_bad", matureNet)])),
      );
    },
  );
  it("rejects arithmetic overflow rather than producing approximate money", () => {
    awaitInvalid(() =>
      planRecipientPayout(
        options([source("tr_a", Number.MAX_SAFE_INTEGER), source("tr_b", 1)]),
      ),
    );
    awaitInvalid(() =>
      planRecipientPayout(
        options([source("tr_a", -Number.MAX_SAFE_INTEGER, { paidAmount: 1 })]),
      ),
    );
    awaitInvalid(() =>
      planRecipientPayout({
        ...options(),
        providerAvailable: -Number.MAX_SAFE_INTEGER,
        independentLiabilities: 1,
      }),
    );
  });
  it("holds on a negative provider balance without erasing entitlement", () => {
    expect(
      planRecipientPayout({ ...options(), providerAvailable: -100 }),
    ).toMatchObject({
      status: "held",
      reason: "insufficient_available",
      matureUnpaid: 1000,
    });
  });
  it("rejects negative independent liabilities", () => {
    awaitInvalid(() =>
      planRecipientPayout({ ...options(), independentLiabilities: -1 }),
    );
  });
});
function awaitInvalid(action: () => unknown) {
  expect(action).toThrow(/Invalid|Unsafe|Duplicate/);
}
it("deducts confirmed payout fees from entitlement without deducting them twice from provider availability", () => {
  expect(
    planRecipientPayout({
      ...options([source("tr_one", 1500)]),
      providerAvailable: 1470,
      confirmedFees: 30,
    }),
  ).toMatchObject({ status: "qualified", amount: 1470, matureUnpaid: 1470 });
  expect(
    planRecipientPayout({
      ...options([source("tr_one", 1000)]),
      providerAvailable: 5000,
      confirmedFees: 30,
    }),
  ).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 970,
  });
});
it("does not qualify the gross threshold while known independent liabilities remain", () => {
  expect(
    planRecipientPayout({
      ...options(),
      providerAvailable: 5000,
      independentLiabilities: 1,
    }),
  ).toMatchObject({
    status: "held",
    reason: "below_threshold",
    matureUnpaid: 999,
  });
});
