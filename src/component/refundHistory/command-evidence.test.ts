import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";

import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

const read = makeFunctionReference<
  "query",
  {
    commandKey: string;
    accountId: string;
    stripePaymentIntentId: string;
    stripeChargeId: string;
    currency: string;
  },
  {
    status: string;
    reason?: string;
    refund?: {
      stripeRefundId: string;
      amount: number;
      currency: string;
      status: string;
    };
  }
>("refundHistory/queries:getRefundCommandEvidence");
const scope = {
  commandKey: "dojo-refund:original_command:v1",
  accountId: "acct_original",
  stripePaymentIntentId: "pi_original",
  stripeChargeId: "ch_original",
  currency: "jpy",
};
const refund = {
  stripeRefundId: "re_original",
  accountId: scope.accountId,
  stripePaymentIntentId: scope.stripePaymentIntentId,
  stripeChargeId: scope.stripeChargeId,
  amount: 500,
  currency: scope.currency,
  status: "pending" as const,
  metadata: {
    betterStripeRefundCommand: scope.commandKey,
    betterStripeRefundFingerprint: "a".repeat(64),
  },
};

it("observes original units and pending state through exact command evidence without declaring completed money", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(await t.query(read, scope)).toMatchObject({
    status: "observed",
    refund: {
      stripeRefundId: "re_original",
      amount: 500,
      currency: "jpy",
      status: "pending",
    },
  });
});

it("holds exact-key uniqueness when an unnormalized legacy metadata duplicate exists", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("refunds", { ...refund, stripeRefundId: "re_legacy" }),
  );
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "normalization_incomplete",
  });
  const actual = await t.run((ctx) => ctx.db.query("refunds").take(3));
  expect(actual).toHaveLength(2);
  expect(
    actual.every(
      (row) => row.metadata.betterStripeRefundCommand === scope.commandKey,
    ),
  ).toBe(true);
});

it("observes metadata enrichment of an already-read row independently of a history cursor", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    metadata: {},
  });
  const first = await t.query(api.refundHistory.queries.paginateRefunds, {
    accountId: scope.accountId,
    stripePaymentIntentId: scope.stripePaymentIntentId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(first.page[0]?.metadata).toEqual({});
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(await t.query(read, scope)).toMatchObject({
    status: "observed",
    refund: { stripeRefundId: refund.stripeRefundId },
  });
});

it("observes a later refund without restarting an exhausted historical scan", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    stripeRefundId: "re_earlier",
    metadata: {},
  });
  const first = await t.query(api.refundHistory.queries.paginateRefunds, {
    accountId: scope.accountId,
    stripePaymentIntentId: scope.stripePaymentIntentId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  const terminal = first.isDone
    ? first
    : await t.query(api.refundHistory.queries.paginateRefunds, {
        accountId: scope.accountId,
        stripePaymentIntentId: scope.stripePaymentIntentId,
        paginationOpts: { numItems: 1, cursor: first.continueCursor },
      });
  expect(terminal.isDone).toBe(true);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(await t.query(read, scope)).toMatchObject({
    status: "observed",
    refund: { stripeRefundId: refund.stripeRefundId },
  });
});

it("detects duplicates before filtering foreign scope into apparent unique evidence", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    stripeRefundId: "re_foreign",
    accountId: "acct_foreign",
  });
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "ambiguous",
  });
});

it.each([
  "accountId",
  "stripePaymentIntentId",
  "stripeChargeId",
  "currency",
] as const)("reports foreign %s evidence instead of missing", async (field) => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    [field]: field === "currency" ? "usd" : "foreign",
  });
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "scope_mismatch",
  });
});

it("preserves the known key on an omitted-metadata partial upsert", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  const { metadata, ...partial } = refund;
  void metadata;
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...partial,
    status: "succeeded",
  });
  expect(await t.query(read, scope)).toMatchObject({
    status: "observed",
    refund: { status: "succeeded" },
  });
});

it.each([
  {},
  null,
  { betterStripeRefundCommand: "changed_command_key_123" },
  { betterStripeRefundCommand: false },
])("latches conflicting explicit metadata enrichment %#", async (metadata) => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  await t.mutation(api.connect.mutations.upsertRefund, { ...refund, metadata });
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "correlation_conflict",
  });
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "correlation_conflict",
  });
});

it("keeps absent indexed evidence explicitly unavailable", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "missing",
  });
});

it("normalizes legacy first-known metadata before applying contradictory new metadata", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("refunds", refund));
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    metadata: { betterStripeRefundCommand: "different_command_key_123" },
  });
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "correlation_conflict",
  });
});

it("normalizes legacy metadata on a partial upsert without inventing provider-creation provenance", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("refunds", refund));
  const { metadata, ...partial } = refund;
  void metadata;
  await t.mutation(api.connect.mutations.upsertRefund, partial);
  expect(await t.query(read, scope)).toMatchObject({ status: "observed" });
});

it("holds global legacy coverage even for an unrelated unnormalized refund", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  await t.run((ctx) =>
    ctx.db.insert("refunds", {
      ...refund,
      stripeRefundId: "re_legacy_unrelated",
      metadata: {},
    }),
  );
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "normalization_incomplete",
  });
});

it("reports actual legacy duplicates after both records have been re-observed", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("refunds", { ...refund, stripeRefundId: "re_legacy" }),
  );
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "normalization_incomplete",
  });
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    stripeRefundId: "re_legacy",
  });
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "ambiguous",
  });
});

it.each([0, -1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
  "keeps malformed observed amount %s unavailable",
  async (amount) => {
    const t = convexTest(schema, modules);
    await t.mutation(api.connect.mutations.upsertRefund, { ...refund, amount });
    expect(await t.query(read, scope)).toEqual({
      status: "unavailable",
      reason: "invalid_receipt",
    });
  },
);

it("rejects duplicated provider receipt identity even when its indexed command keys differ", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  await t.run((ctx) =>
    ctx.db.insert("refunds", {
      ...refund,
      metadata: { betterStripeRefundCommand: "legacy_other_command_123" },
      refundCommandNormalizationVersion: 1,
      refundCommandKey: "legacy_other_command_123",
      refundCommandObservedAt: Date.now(),
    }),
  );
  expect(await t.query(read, scope)).toEqual({
    status: "unavailable",
    reason: "ambiguous",
  });
});
