// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { expect, it, vi, beforeEach } from "vitest";
import { modules } from "../../../../test";
import schema from "../../../schema";
import componentSchema from "../../../../../src/component/schema";
import { components } from "../../../_generated/api";
const provider = vi.hoisted(() => ({
  groupId: "",
  amount: 11,
  status: "paid",
  incomplete: false,
}));
beforeEach(() => {
  provider.amount = 11;
  provider.status = "paid";
  provider.incomplete = false;
});
vi.mock("../../../stripe/helpers", async () => {
  const { CostRecoveryClient } =
    await import("../../../../../src/client/costRecovery");
  const { components } = await import("../../../_generated/api");
  return {
    stripe: {
      costRecovery: new CostRecoveryClient(
        components.betterStripe,
        () =>
          ({
            invoices: {
              retrieve: async () => ({
                id: "in_cost",
                object: "invoice",
                customer_account: "acct_store",
                currency: "usd",
                status: provider.status,
              }),
            },
            invoiceItems: {
              list: async () => ({
                object: "list",
                has_more: provider.incomplete,
                data: [
                  {
                    id: "ii_original",
                    object: "invoiceitem",
                    invoice: "in_cost",
                    customer_account: "acct_store",
                    currency: "usd",
                    amount: provider.amount,
                    discountable: false,
                    metadata: { bsRecoveryGroup: provider.groupId },
                  },
                ],
              }),
            },
          }) as unknown as import("stripe").default,
      ),
    },
  };
});
async function fixture(outcome: "collect" | "release") {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../../src/component/**/*.ts"),
  );
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  const scope = {
      accountId: "acct_store",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
    },
    groupKey = "example:cost-invoice:in_cost";
  for (let i = 0; i < 11; i++) {
    await t.mutation(components.betterStripe.costRecovery.mutations.record, {
      ...scope,
      claimKey: `legacy:${i}`,
      sourceChargeId: `ch_${i}`,
      sourceGross: 1000,
      sourceProcessingFee: 30,
      amountDue: 1,
      revision: 0,
    });
    await t.mutation(components.betterStripe.costRecovery.mutations.reserve, {
      ...scope,
      groupKey,
      sourceKind: "invoice",
      sourceId: "in_cost",
      maxDebit: 1000,
      maxCredit: 0,
      operationKey: `legacy:${i}`,
      limit: 1,
    });
  }
  await t.mutation(components.betterStripe.costRecovery.mutations.seal, {
    groupKey,
  });
  await t.mutation(
    components.betterStripe.costRecovery.mutations.bindInvoiceItem,
    { groupKey, invoiceItemId: "ii_original" },
  );
  await t.mutation(components.betterStripe.costRecovery.mutations.finish, {
    groupKey,
    outcome,
    limit: 1,
  });
  provider.groupId = (await t.query(
    components.betterStripe.costRecovery.queries.group,
    { groupKey },
  ))!._id;
  return { t, sellerId, scope, groupKey };
}
it.each(["collect", "release"] as const)(
  "finishes11 mapped legacy reservations in persisted %s direction and replays metadata once",
  async (outcome) => {
    const { t, sellerId, scope } = await fixture(outcome);
    const args = {
      sellerId,
      invoiceId: "in_cost",
      currency: "usd",
      outcome,
      invoiceItemId: "ii_original",
      amount: 11,
    };
    await t.mutation(
      anyApi.sellerCosts.recoveryInvoices.workflow.mutations.finishLegacy,
      args,
    );
    expect(
      await t.query(
        components.betterStripe.costRecovery.queries.balance,
        scope,
      ),
    ).toMatchObject({
      collectedAmount: outcome === "collect" ? 11 : 0,
      reservedAmount: 0,
      outstanding: outcome === "collect" ? 0 : 11,
    });
    await t.mutation(
      anyApi.sellerCosts.recoveryInvoices.workflow.mutations.finishLegacy,
      args,
    );
    expect(
      await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
    ).toMatchObject([{ kind: "invoice", status: "completed" }]);
  },
);
it("rejects changed receipt economics, item or persisted direction without finishing any additional reservation", async () => {
  const { t, sellerId, scope } = await fixture("collect");
  const args = {
    sellerId,
    invoiceId: "in_cost",
    currency: "usd",
    outcome: "collect",
    invoiceItemId: "ii_original",
    amount: 11,
  };
  for (const changed of [
    { amount: 12 },
    { invoiceItemId: "ii_foreign" },
    { outcome: "release" },
  ])
    await expect(
      t.mutation(
        anyApi.sellerCosts.recoveryInvoices.workflow.mutations.finishLegacy,
        { ...args, ...changed },
      ),
    ).rejects.toThrow(/bindings/i);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 1, reservedAmount: 10 });
});

it("uses complete provider proof before a legacy action finishes and leaves mismatched evidence held", async () => {
  const { t, sellerId, scope } = await fixture("collect");
  provider.amount = 12;
  await t.action(anyApi.sellerCosts.recoveryInvoices.actions.reconcile, {
    sellerId,
    invoiceId: "in_cost",
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 1, reservedAmount: 10 });
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ status: "blocked", reason: "legacy_inflight_unknown" }]);
  provider.amount = 11;
  await t.action(anyApi.sellerCosts.recoveryInvoices.actions.reconcile, {
    sellerId,
    invoiceId: "in_cost",
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 11, reservedAmount: 0 });
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ status: "completed" }]);
});
it("does not infer release from a canceled invoice while the persisted group is collecting", async () => {
  const { t, sellerId, scope } = await fixture("collect");
  provider.status = "void";
  await expect(
    t.action(anyApi.sellerCosts.recoveryInvoices.actions.reconcile, {
      sellerId,
      invoiceId: "in_cost",
    }),
  ).rejects.toThrow(/bindings/i);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, scope),
  ).toMatchObject({ collectedAmount: 1, reservedAmount: 10 });
});
