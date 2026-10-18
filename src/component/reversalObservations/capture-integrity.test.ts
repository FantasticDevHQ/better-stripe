// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { schema, modules } from "../../test.js";
import { captureReversal } from "./capture.js";
import {
  transferFingerprint,
  transferIdentity,
} from "../financialObservations/transferHelpers.js";
it("retains every original transfer reference while omitting an unbounded malformed pin digest", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const transferId = await ctx.db.insert("transfers", {
      stripeTransferId: "tr_bad_pin",
      sourceChargeId: "ch_bad_pin",
      destinationAccountId: "acct_pin",
      amount: 10,
      currency: "usd",
      role: "store",
      status: "paid",
    });
    const row = (await ctx.db.get("transfers", transferId))!;
    const fingerprint = await transferFingerprint(transferIdentity(row));
    await ctx.db.insert("financialTransferObservations", {
      transferId,
      stripeTransferId: row.stripeTransferId,
      sourceChargeId: row.sourceChargeId,
      bucketKey: row.destinationAccountId,
      role: "store",
      ownershipStatus: "unknown",
      producer: "transfer_fact",
      producerVersion: 1,
      fingerprint,
      observedFingerprint: fingerprint,
      ownershipFingerprint: "x".repeat(900_000),
      generation: 1,
      isContradictory: false,
    });
    const id = await ctx.db.insert("transferReversalOps", {
      operationId: "bad_pin",
      sourceChargeId: "ch_bad_pin",
      slices: [{ stripeTransferId: "tr_bad_pin", from: 0, to: 10 }],
    });
    await captureReversal(
      ctx,
      (await ctx.db.get("transferReversalOps", id))!,
      false,
      [row],
    );
    const chunks = await ctx.db.query("reversalObservationRefs").take(5);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].refs[0]).toMatchObject({ transferId });
    expect(chunks[0].refs[0]?.ownershipFingerprint === undefined).toBe(true);
    expect(JSON.stringify(chunks[0]).length).toBeLessThan(2048);
  });
});
it("retains a valid original ownership pin using the existing transfer fingerprint encoding", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const transferId = await ctx.db.insert("transfers", {
      stripeTransferId: "tr_valid_pin",
      sourceChargeId: "ch_valid_pin",
      destinationAccountId: "acct_pin",
      amount: 10,
      currency: "usd",
      role: "store",
      status: "paid",
    });
    const row = (await ctx.db.get("transfers", transferId))!;
    const registrationId = await ctx.db.insert("financialOwnership", {
      bucketKey: "acct_pin",
      kind: "logical",
      userId: "original_owner",
      source: { integration: "test", recordId: "original" },
      generation: 1,
    });
    const fingerprint = await transferFingerprint(transferIdentity(row));
    const ownershipFingerprint = await transferFingerprint({
      registrationId,
      userId: "original_owner",
      ownershipStatus: "registered",
    });
    const markerId = await ctx.db.insert("financialTransferObservations", {
      transferId,
      stripeTransferId: row.stripeTransferId,
      sourceChargeId: row.sourceChargeId,
      bucketKey: row.destinationAccountId,
      role: "store",
      registrationId,
      userId: "original_owner",
      ownershipStatus: "registered",
      producer: "transfer_fact",
      producerVersion: 1,
      fingerprint,
      observedFingerprint: fingerprint,
      ownershipFingerprint,
      generation: 1,
      isContradictory: false,
    });
    const id = await ctx.db.insert("transferReversalOps", {
      operationId: "valid_pin",
      sourceChargeId: "ch_valid_pin",
      slices: [{ stripeTransferId: "tr_valid_pin", from: 0, to: 10 }],
    });
    await captureReversal(
      ctx,
      (await ctx.db.get("transferReversalOps", id))!,
      false,
      [row],
    );
    const chunks = await ctx.db.query("reversalObservationRefs").take(5);
    expect(chunks[0].refs[0]).toMatchObject({
      transferId,
      markerId,
      registrationId,
      ownershipFingerprint,
    });
  });
});
