import assert from "node:assert/strict";
import { BetterStripe } from "../../../../index.js";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { captureMaintainedActionSelection } from "./classOwnedActionRoot.js";
import {
  createActionOperationJournal,
  createClassActionOperationJournal,
  consumeClassReservation,
} from "../operationJournal.js";
import { convexTest } from "convex-test";
import {
  actionGeneric,
  componentsGeneric,
  defineSchema,
  makeFunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { getConvexSize, getDocumentSize, v } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import { modules, schema } from "../../../../../test.js";
import { query } from "../../../../../component/_generated/server.js";
import type { Doc } from "../../../../../component/_generated/dataModel.js";
import {
  canonical,
  codecFixture,
  VALUE_LIMIT,
} from "../../../../../component/renewalOperations/timingPolicy.fixtures.js";

const refs = components.betterStripe.renewalOperations;
const nested = componentsGeneric();
const cases = [
  "once",
  "copies",
  "duplicate",
  "foreign-op",
  "foreign-root",
  "invalid-expected",
  "extra-arity",
  "generic-data",
  "conflict",
  "rejected",
  "retarget",
] as const;
type Mode = (typeof cases)[number];
type Reserved = FunctionReturnType<typeof refs.mutations.reserveAttempt>;
const route = makeFunctionReference<
  "action",
  { operationId: string; foreignId: string; mode: Mode },
  null
>("winningCall:run");
type Physical = {
  operations: Doc<"renewalOperations">[];
  attempts: Doc<"renewalOperationAttempts">[];
  events: Doc<"renewalOperationEvents">[];
  payloads: Doc<"renewalOperationPayloads">[];
};
const inspection = {
  physical: query({
    args: {},
    handler: async (ctx): Promise<Physical> => ({
      operations: await ctx.db.query("renewalOperations").take(4),
      attempts: await ctx.db.query("renewalOperationAttempts").take(4),
      events: await ctx.db.query("renewalOperationEvents").take(4),
      payloads: await ctx.db.query("renewalOperationPayloads").take(5),
    }),
  }),
};
const callError = /^CLASS_JOURNAL_CALL_UNBOUND$/;
afterEach(() => vi.unstubAllGlobals());

it.each(cases)(
  "WINNING-CALL %s preserves actual-call identity and one-use ordering",
  async (mode) => {
    const h = await codecFixture();
    const foreignLogical = h.record.logicalOperationId + "-winning-foreign";
    const foreignJSON = canonical({
      ...h.record,
      logicalOperationId: foreignLogical,
    });
    const roots = [
      new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_invalid_winning_fixture",
      }),
      new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_invalid_winning_fixture",
      }),
    ];
    expect(roots[0]).not.toBe(roots[1]);
    let selectorReads = 0;
    const descriptors = roots.map((sdk) => {
      const descriptor = Object.getOwnPropertyDescriptor(sdk, "_apiKey");
      assert(descriptor && "value" in descriptor && descriptor.configurable);
      Object.defineProperty(sdk, "_apiKey", {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          selectorReads++;
          throw Error("WINNING_SELECTOR_TOUCHED");
        },
      });
      return descriptor;
    });
    try {
      let stable: Physical | null = null;
      const progress = { entry: 0, binding: 0, reserve: 0, consume: 0 };
      const host = {
        run: actionGeneric({
          args: {
            operationId: v.string(),
            foreignId: v.string(),
            mode: v.string(),
          },
          handler: async (ctx, args): Promise<null> => {
            progress.entry++;
            expect(args.mode).toBe(mode);
            expect(await ctx.meta.getFunctionMetadata()).toEqual({
              name: "winningCall:run",
              componentPath: "",
              type: "action",
              visibility: "public",
            });
            const input = {
              expectedRevision: 0,
              stage: "attach" as const,
              expectedRequestBinding: h.record.requestBinding,
              recordJSON: h.recordJSON,
            };
            expect(getConvexSize(input)).toBeLessThanOrEqual(VALUE_LIMIT);
            const direct = await ctx.runQuery(
              refs.queries.loadAuthorizedOperation,
              { operationId: args.operationId },
            );
            expect(direct).toEqual({
              recordVersion: 2,
              operationId: args.operationId,
              recordJSON: h.recordJSON,
              revision: 0,
              activeAttempt: null,
              initialBasis: null,
            });
            expect(
              await ctx.runQuery(
                nested.betterStripe.winningInspection.physical,
                {},
              ),
            ).toEqual(before);
            await expect(
              captureMaintainedActionSelection(roots[0], {
                actualActionCtx: ctx,
                operationId: args.operationId,
              }),
            ).rejects.toThrow(/^CLASS_ACTION_PROFILE_UNBOUND$/);
            const journal = await createClassActionOperationJournal(roots[0], {
              actualActionCtx: ctx,
              operationId: args.operationId,
            });
            expect(await journal.loadAuthorizedOperation()).toEqual(direct);
            progress.binding++;
            async function observe(reply: Reserved) {
              assert(reply.disposition !== "conflict");
              const reservation = reply.reservation;
              expect(reservation.operationId).toBe(args.operationId);
              expect(reservation.recordJSON).toBe(h.recordJSON);
              const manifest = await ctx.runQuery(refs.queries.readAttempt, {
                operationId: args.operationId,
                attemptId: reservation.attemptId,
              });
              expect(manifest).toEqual({ reservation, events: [] });
              const after: Physical = await ctx.runQuery(
                nested.betterStripe.winningInspection.physical,
                {},
              );
              const primary = before.operations.find(
                (row) => row._id === args.operationId,
              );
              assert(primary);
              expect(after.operations).toHaveLength(2);
              expect(
                after.operations.find((row) => row._id === args.operationId),
              ).toEqual({
                ...primary,
                state: "RESERVED",
                revision: 1,
                activeAttemptId: reservation.attemptId,
              });
              expect(
                after.operations.find((row) => row._id === args.foreignId),
              ).toEqual(
                before.operations.find((row) => row._id === args.foreignId),
              );
              expect(after.attempts).toHaveLength(1);
              const {
                attemptId,
                recordJSON: _recordJSON,
                ...fields
              } = reservation;
              expect(after.attempts[0]).toEqual({
                ...fields,
                _id: attemptId,
                _creationTime: after.attempts[0]._creationTime,
                lastSequence: 0,
              });
              expect(after.events).toEqual([]);
              expect(after.payloads).toEqual(before.payloads);
              expect(getConvexSize(reply)).toBeLessThanOrEqual(VALUE_LIMIT);
              stable = after;
            }
            if (mode === "generic-data") {
              const data = await createActionOperationJournal(
                ctx,
                components.betterStripe,
                args.operationId,
              );
              expect(
                Object.prototype.hasOwnProperty.call(
                  data,
                  "reserveFreshAttempt",
                ),
              ).toBe(false);
              const raw = await data.reserveAttempt(input);
              assert(raw.disposition === "acquired");
              await observe(raw);
              const existing = await journal.reserveFreshAttempt(input);
              progress.reserve++;
              expect(existing).toEqual({
                result: {
                  disposition: "existing",
                  committedRevision: 1,
                  reservation: raw.reservation,
                },
                call: null,
              });
              expect(() => consumeClassReservation(raw, journal)).toThrow(
                callError,
              );
              expect(() =>
                consumeClassReservation(raw.reservation, journal),
              ).toThrow(callError);
              return null;
            }
            if (mode === "conflict") {
              const fresh = await journal.reserveFreshAttempt({
                ...input,
                expectedRequestBinding: "different-request-binding",
              });
              progress.reserve++;
              expect(fresh).toEqual({
                result: { disposition: "conflict", reason: "identity_changed" },
                call: null,
              });
              expect(
                await ctx.runQuery(
                  nested.betterStripe.winningInspection.physical,
                  {},
                ),
              ).toEqual(before);
              return null;
            }
            if (mode === "rejected") {
              await expect(
                journal.reserveFreshAttempt({ ...input, recordJSON: "{}" }),
              ).rejects.toThrow(/^RENEWAL_JOURNAL_JSON_STOP$/);
              progress.reserve++;
              expect(
                await ctx.runQuery(
                  nested.betterStripe.winningInspection.physical,
                  {},
                ),
              ).toEqual(before);
              return null;
            }
            const fresh = await journal.reserveFreshAttempt(input);
            progress.reserve++;
            assert(fresh.result.disposition === "acquired");
            await observe(fresh.result);
            // The exact real CAS/data/physical transition precedes missing-handle RED.
            expect(fresh.call).not.toBeNull();
            assert(fresh.call !== null);
            const winningCall = fresh.call;
            expect(Object.isFrozen(winningCall)).toBe(true);
            const reservation = fresh.result.reservation;
            if (mode === "foreign-op" || mode === "foreign-root") {
              const foreign = await createClassActionOperationJournal(
                mode === "foreign-root" ? roots[1] : roots[0],
                {
                  actualActionCtx: ctx,
                  operationId:
                    mode === "foreign-root" ? args.operationId : args.foreignId,
                },
              );
              expect(() =>
                consumeClassReservation(winningCall, foreign),
              ).toThrow(callError);
              expect(() =>
                consumeClassReservation(winningCall, journal),
              ).toThrow(callError);
            } else if (mode === "invalid-expected") {
              let traps = 0;
              const invalid = Proxy.revocable(journal, {
                get() {
                  traps++;
                  throw Error("EXPECTED_REFLECTED");
                },
              });
              invalid.revoke();
              expect(() =>
                consumeClassReservation(winningCall, invalid.proxy),
              ).toThrow(callError);
              expect(() =>
                consumeClassReservation(winningCall, journal),
              ).toThrow(callError);
              expect(traps).toBe(0);
            } else if (mode === "extra-arity") {
              expect(() =>
                Reflect.apply(consumeClassReservation, undefined, [
                  winningCall,
                  journal,
                  {},
                ]),
              ).toThrow(callError);
              expect(() =>
                consumeClassReservation(winningCall, journal),
              ).toThrow(callError);
            } else if (mode === "retarget") {
              const descriptor = Object.getOwnPropertyDescriptor(
                ctx,
                "runQuery",
              );
              assert(descriptor && "value" in descriptor);
              let invoked = 0;
              Object.defineProperty(ctx, "runQuery", {
                ...descriptor,
                value: () => {
                  invoked++;
                  throw Error("RETARGETED_RPC_CALLED");
                },
              });
              try {
                expect(() =>
                  consumeClassReservation(winningCall, journal),
                ).toThrow(callError);
              } finally {
                Object.defineProperty(ctx, "runQuery", descriptor);
              }
              expect(invoked).toBe(0);
              expect(() =>
                consumeClassReservation(winningCall, journal),
              ).toThrow(callError);
              await expect(journal.loadAuthorizedOperation()).rejects.toThrow(
                /^CLASS_ACTION_JOURNAL_UNBOUND$/,
              );
            } else {
              if (mode === "copies") {
                let traps = 0;
                const proxy = new Proxy(winningCall, {
                  get() {
                    traps++;
                    throw Error("CALL_REFLECTED");
                  },
                  getPrototypeOf() {
                    traps++;
                    throw Error("CALL_PROTO_REFLECTED");
                  },
                });
                for (const invalid of [
                  fresh.result,
                  reservation,
                  { ...winningCall },
                  JSON.parse(JSON.stringify(winningCall)),
                  Object.create(Object.getPrototypeOf(winningCall)),
                  proxy,
                ])
                  expect(() =>
                    consumeClassReservation(invalid, journal),
                  ).toThrow(callError);
                expect(traps).toBe(0);
              }
              if (mode === "duplicate") {
                const duplicate = await journal.reserveFreshAttempt(input);
                progress.reserve++;
                expect(duplicate).toEqual({
                  result: {
                    disposition: "existing",
                    committedRevision: 1,
                    reservation,
                  },
                  call: null,
                });
                const queried = await journal.readAttempt({
                  attemptId: reservation.attemptId,
                });
                assert(queried);
                expect(() =>
                  consumeClassReservation(queried.reservation, journal),
                ).toThrow(callError);
              }
              const consumed = consumeClassReservation(winningCall, journal);
              progress.consume++;
              expect(consumed.reservation).toBe(reservation);
              expect(typeof consumed.tag).toBe("object");
              expect(Object.isFrozen(consumed)).toBe(true);
              expect(() =>
                consumeClassReservation(winningCall, journal),
              ).toThrow(callError);
            }
            expect(selectorReads).toBe(0);
            await expect(
              captureMaintainedActionSelection(roots[0], {
                actualActionCtx: ctx,
                operationId: args.operationId,
              }),
            ).rejects.toThrow(/^CLASS_ACTION_PROFILE_UNBOUND$/);
            return null;
          },
        }),
      };
      const t = convexTest(defineSchema({}), {
        "./_generated/api.ts": async () => ({}),
        "./winningCall.ts": async () => host,
      });
      expect(
        Object.prototype.hasOwnProperty.call(
          modules,
          "./component/winningInspection.ts",
        ),
      ).toBe(false);
      t.registerComponent("betterStripe", schema, {
        ...modules,
        "./component/winningInspection.ts": async () => inspection,
      });
      const physical = async (): Promise<Physical> =>
        t.query(nested.betterStripe.winningInspection.physical, {});
      expect(await physical()).toEqual({
        operations: [],
        attempts: [],
        events: [],
        payloads: [],
      });
      const create = {
        authorizationScope: h.record.authorization.scope,
        authorizationRevision: h.record.authorization.revision,
        logicalOperationId: h.record.logicalOperationId,
        recordJSON: h.recordJSON,
      };
      const primary = await t.mutation(
        refs.mutations.createAuthorizedOperation,
        create,
      );
      const foreign = await t.mutation(
        refs.mutations.createAuthorizedOperation,
        {
          ...create,
          logicalOperationId: foreignLogical,
          recordJSON: foreignJSON,
        },
      );
      assert(primary.status === "created" && foreign.status === "created");
      const before = await physical();
      expect(before.operations).toHaveLength(2);
      expect(before.attempts).toEqual([]);
      expect(before.events).toEqual([]);
      expect(before.payloads).toHaveLength(2);
      for (const operation of before.operations) {
        const recordJSON =
          operation._id === primary.operationId ? h.recordJSON : foreignJSON;
        expect(
          await t.query(refs.queries.loadAuthorizedOperation, {
            operationId: operation._id,
          }),
        ).toEqual({
          recordVersion: 2,
          operationId: operation._id,
          recordJSON,
          revision: 0,
          activeAttempt: null,
          initialBasis: null,
        });
        const payload = before.payloads.find(
          (row) => row._id === operation.payloadId,
        );
        assert(payload);
        expect(payload.json).toBe(recordJSON);
        expect(payload.owner).toEqual({
          kind: "operation",
          operationId: operation._id,
        });
      }
      stable = before;
      let failed = false;
      try {
        await t.action(route, {
          operationId: primary.operationId,
          foreignId: foreign.operationId,
          mode,
        });
        expect(progress.entry).toBe(1);
        expect(progress.binding).toBe(1);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        try {
          const after = await physical();
          expect(after).toEqual(stable);
          for (const rows of Object.values(after))
            for (const row of rows)
              expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
          expect(selectorReads).toBe(0);
          expect(h.fetchCalls()).toBe(0);
          console.info(
            "WINNING_CALL_SETTLEMENT",
            JSON.stringify({
              mode,
              ...progress,
              physicalEqual: true,
              selectorReads,
              fetchCalls: 0,
            }),
          );
        } catch (error) {
          if (!failed) throw error;
          console.info("WINNING_CALL_INSPECTION_FAILED");
        }
      }
    } finally {
      roots.forEach((sdk, index) =>
        Object.defineProperty(sdk, "_apiKey", descriptors[index]),
      );
    }
  },
);
