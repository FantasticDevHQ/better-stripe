/**
 * Type-level guard for the generated component surface (BTS-70 / BTS-78).
 *
 * BTS-70 retyped `src/component/_generated/component.ts` from `any` to real
 * shapes, but nothing actually CONSUMED the typed surface or asserted its
 * shape — a silent regression back to `any` (e.g. a bad manual edit, or a
 * codegen run against a broken schema) would still pass every existing test
 * and typecheck cleanly, because `any` is assignable to (and from) anything.
 *
 * This file is a real `.ts` module under `src/**`, so `tsc --noEmit`
 * (`pnpm typecheck`) actually evaluates the type-level assertions below —
 * unlike a runtime-only vitest check, a broken type here fails the build, not
 * just a test run. Two things are enforced against
 * `connect/queries.ts`'s `listTransfersByCharge` / `listDisputes`:
 *
 * 1. Not `any` — `IsAny<T>` catches the "regressed back to `any`" failure
 *    mode directly (item 5).
 * 2. Same field set as the REAL validators (`transferDocValidator` /
 *    `disputeDocValidator`, the actual source of truth in
 *    `connect/validators.ts`) — this is the staleness guard (item 6): if a
 *    field is added/renamed/removed in the validator and `_generated` isn't
 *    regenerated to match, the generated type's key set drifts from the real
 *    one and this fails to compile. (`_id`'s branded `Id<"...">` narrows to a
 *    plain `string` across the component boundary by design, so key-set
 *    equality — not full structural equality — is the right check here.)
 */
import type { Infer } from "convex/values";
import { describe, expect, it } from "vitest";

import type { ComponentApi } from "../component/_generated/component.js";
import {
  disputeDocValidator,
  transferDocValidator,
} from "../component/connect/validators.js";
import type { Component, RunCtx } from "./helpers.js";

// ---------------------------------------------------------------------------
// Type-level test utilities (no runtime cost — pure `type` declarations)
// ---------------------------------------------------------------------------

/** Classic "is this type exactly `any`?" check (`any` is the only type where `1 & T` collapses to `0 | 1`). */
type IsAny<T> = 0 extends 1 & T ? true : false;
type NotAny<T> = IsAny<T> extends true ? false : true;

/** Exact key-set equality, ignoring value types (so branded `Id<...>` vs plain `string` doesn't trip it). */
type KeysEqual<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// Real (source-of-truth) row shapes, from the validators `connect/queries.ts`
// actually declares its `returns:` against.
// ---------------------------------------------------------------------------

type RealTransferRow = Infer<typeof transferDocValidator>;
type RealDisputeRow = Infer<typeof disputeDocValidator>;

// ---------------------------------------------------------------------------
// Generated shapes, from the checked-in `_generated/component.ts`.
// ---------------------------------------------------------------------------

type TransfersReturn =
  ComponentApi["connect"]["queries"]["listTransfersByCharge"]["_returnType"];
type GeneratedTransferRow =
  TransfersReturn extends Array<infer Row> ? Row : never;

type DisputesReturn =
  ComponentApi["connect"]["queries"]["listDisputes"]["_returnType"];
type GeneratedDisputeRow =
  DisputesReturn extends Array<infer Row> ? Row : never;

// ---------------------------------------------------------------------------
// Item 5 — not `any` (a bare regression to `any` would make every check below
// vacuously pass otherwise, so this is asserted directly and first).
// ---------------------------------------------------------------------------

type _TransfersReturnNotAny = Expect<NotAny<TransfersReturn>>;
type _DisputesReturnNotAny = Expect<NotAny<DisputesReturn>>;
type _GeneratedTransferRowNotAny = Expect<NotAny<GeneratedTransferRow>>;
type _GeneratedDisputeRowNotAny = Expect<NotAny<GeneratedDisputeRow>>;

// ---------------------------------------------------------------------------
// Item 6 — the generated field set matches the real validators (staleness
// guard: catches `_generated` drifting from `connect/queries.ts`).
// ---------------------------------------------------------------------------

type _TransferKeysInSync = Expect<
  KeysEqual<GeneratedTransferRow, RealTransferRow>
>;
type _DisputeKeysInSync = Expect<
  KeysEqual<GeneratedDisputeRow, RealDisputeRow>
>;

// ---------------------------------------------------------------------------
// A realistic typed consumer: a client-level helper that calls the component
// query refs the way `src/client/**` actually does (via `RunCtx.runQuery`)
// and narrows on fields that only exist with the real (non-`any`) types.
// Never invoked at runtime — its only job is to typecheck.
// ---------------------------------------------------------------------------

async function _typedConsumerSmoke(
  component: Component,
  ctx: RunCtx,
  sourceChargeId: string,
): Promise<{ transferTotal: number; openDisputeCount: number }> {
  const transfers = await ctx.runQuery(
    component.connect.queries.listTransfersByCharge,
    { sourceChargeId },
  );
  const disputes = await ctx.runQuery(component.connect.queries.listDisputes, {
    stripePaymentIntentId: sourceChargeId,
  });

  const transferTotal = transfers.reduce(
    (sum, transfer) => sum + transfer.amount,
    0,
  );
  const openDisputeCount = disputes.filter(
    (dispute) => dispute.status === "needs_response",
  ).length;

  return { transferTotal, openDisputeCount };
}
void _typedConsumerSmoke;

describe("ComponentApi typed consumer smoke (BTS-70 / BTS-78)", () => {
  it("exposes listTransfersByCharge / listDisputes with real (non-any) typed rows", () => {
    // The actual guard is the type-level assertions above, which run under
    // `tsc --noEmit`; this runtime assertion just keeps the file a real test.
    expect(typeof disputeDocValidator).toBe("object");
    expect(typeof transferDocValidator).toBe("object");
  });
});
