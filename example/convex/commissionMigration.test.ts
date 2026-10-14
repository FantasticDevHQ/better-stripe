// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import componentSchema from "../../dist/component/schema.js";
import { components, internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");
it("migrates existing one-time terms transactionally without resetting their first invoice", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  await t.run(async (ctx) =>
    ctx.db.insert("subscriptionCommissions", {
      stripeSubscriptionId: "sub_migrate",
      affiliateCommissionTerm: "one_time",
      firstInvoiceId: "in_original",
      affiliateAccountId: "acct_a",
    }),
  );
  expect(await t.mutation(internal.commissionMigration.run, {})).toBe(1);
  expect(await t.mutation(internal.commissionMigration.run, {})).toBe(0);
  expect(
    await t.query(
      components.betterStripe.settlement.queries.getCommissionTerm,
      { subscriptionId: "sub_migrate" },
    ),
  ).toMatchObject({
    term: "one_time",
    firstPaidInvoiceId: "in_original",
    affiliateAccountId: "acct_a",
  });
  expect(
    await t.mutation(
      components.betterStripe.settlement.mutations.claimCommissionInvoice,
      {
        subscriptionId: "sub_migrate",
        invoiceId: "in_renewal",
        firstPaidInvoiceId: "in_renewal",
        term: "forever",
        affiliateAccountId: "acct_a",
      },
    ),
  ).toMatchObject({
    eligible: false,
    term: "one_time",
    firstPaidInvoiceId: "in_original",
  });
});
