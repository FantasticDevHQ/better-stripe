// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { Triggers } from "convex-helpers/server/triggers";
import { expect, it } from "vitest";
import type { DataModel } from "../_generated/dataModel.js";
import { schema, modules } from "../../test.js";
import {
  registerPayoutRevisions,
  financialRevision,
  riskRevision,
} from "./revisions.js";
import { activateRevisionAccount } from "../payoutRevisionJournal/state.js";
const makeTest = () => convexTest(schema, modules);
const triggers = new Triggers<DataModel>();
registerPayoutRevisions(triggers);
const scope = { accountId: "acct_canonical", ownerKey: "owner" };
const writes = [
  {
    table: "transfers" as const,
    value: {
      stripeTransferId: "tr_callback",
      destinationAccountId: scope.accountId,
      amount: 10,
      currency: "usd",
      role: "affiliate" as const,
      status: "paid" as const,
      reversedAmount: 1,
    },
    risk: true,
  },
  {
    table: "payouts" as const,
    value: {
      stripePayoutId: "po_callback",
      accountId: scope.accountId,
      amount: 10,
      currency: "usd",
      status: "pending" as const,
      arrivalDate: "2026-10-18",
    },
    risk: true,
  },
  {
    table: "payoutSourceAllocations" as const,
    value: {
      ...scope,
      stripeTransferId: "tr_callback",
      currency: "usd",
      paidAmount: 0,
      reservedAmount: 10,
    },
    risk: true,
  },
  {
    table: "payoutReleaseClaims" as const,
    value: {
      ...scope,
      operationKey: "callback",
      expectedRevision: 0,
      currency: "usd",
      amount: 10,
      allocations: [],
      observations: [],
      status: "reserved" as const,
    },
    risk: true,
  },
  {
    table: "payoutFeeBalances" as const,
    value: { ...scope, currency: "usd", amount: 10, revision: 0 },
    risk: true,
  },
  {
    table: "recoveryBalances" as const,
    value: {
      accountId: scope.accountId,
      scopeKey: "callback",
      reservedAmount: 0,
      outstanding: 10,
      currency: "usd",
      amountDue: 10,
      collectedAmount: 0,
    },
    risk: true,
  },
];
for (const { table, value } of writes)
  it(`preserves insert, replay, deletion and risk events for activated ${table}`, async () => {
    const t = makeTest();
    await t.run((ctx) => activateRevisionAccount(ctx, scope.accountId));
    const id = await t.run(async (ctx) =>
      triggers.wrapDB(ctx).db.insert(table, value),
    );
    expect(
      await t.run((ctx) => financialRevision(ctx, scope.accountId)),
    ).toEqual({ revision: 1, riskRevision: 1 });
    expect(await t.run((ctx) => riskRevision(ctx, scope.accountId))).toBe(1);
    await t.run(async (ctx) => triggers.wrapDB(ctx).db.patch(table, id, value));
    expect(
      await t.run((ctx) => financialRevision(ctx, scope.accountId)),
    ).toEqual({ revision: 1, riskRevision: 1 });
    await t.run(async (ctx) => triggers.wrapDB(ctx).db.delete(table, id));
    expect(
      await t.run((ctx) => financialRevision(ctx, scope.accountId)),
    ).toEqual({ revision: 2, riskRevision: 2 });
    const events = await t.run((ctx) =>
      ctx.db.query("payoutRiskEvents").take(5),
    );
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      accountId: scope.accountId,
      riskRevision: 2,
      removed: true,
    });
    expect(
      await t.run((ctx) => ctx.db.query("payoutFinancialRevisions").take(5)),
    ).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("payoutRiskRevisions").take(5)),
    ).toEqual([]);
  });
it.each([true, false])(
  "moves transfer accounts with the old account canonical=%s",
  async (oldCanonical) => {
    const t = makeTest();
    const oldId = "acct_old";
    const newId = "acct_new";
    await t.run((ctx) =>
      activateRevisionAccount(ctx, oldCanonical ? oldId : newId),
    );
    const id = await t.run((ctx) =>
      triggers.wrapDB(ctx).db.insert("transfers", {
        stripeTransferId: "tr_move",
        destinationAccountId: oldId,
        amount: 10,
        currency: "usd",
        role: "store",
        status: "paid" as const,
      }),
    );
    await t.run((ctx) =>
      triggers
        .wrapDB(ctx)
        .db.patch("transfers", id, { destinationAccountId: newId }),
    );
    expect(await t.run((ctx) => financialRevision(ctx, oldId))).toEqual({
      revision: 2,
      riskRevision: 1,
    });
    expect(await t.run((ctx) => financialRevision(ctx, newId))).toEqual({
      revision: 1,
      riskRevision: 1,
    });
    const legacy = await t.run((ctx) =>
      ctx.db.query("payoutFinancialRevisions").take(5),
    );
    expect(legacy).toHaveLength(1);
    expect(legacy[0].accountId).toBe(oldCanonical ? newId : oldId);
  },
);
