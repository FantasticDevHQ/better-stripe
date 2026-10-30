import assert from "node:assert/strict";
import { vi } from "vitest";
import { data } from "./configurePreflightControls.js";
import type { ConfigureACKLifecycleDeclaration } from "./observationConfigureACKLifecycleDeclarations.js";

/** TEST-only fault observers. No History, map, returned-flag setter or Source registrar. */
export function installConfigureACKLifecycleInstrumentation(
  d: ConfigureACKLifecycleDeclaration,
) {
  const pending: Promise<unknown>[] = [];
  const state = {
    admitted: null as unknown,
    admissions: 0,
    outputAborts: 0,
    receiptCalls: 0,
    receiptFulfilled: 0,
    receiptRejected: 0,
    wrongACK: 0,
    retirements: 0,
    factoryPairs: 0,
    sourceBindingTrue: 0,
    reservationTrue: 0,
    sameReadTransport: false,
    discardEntered: 0,
    discardCompleted: 0,
  };
  vi.doMock("../configure/output.js", async () => {
    const actual = await vi.importActual<
      typeof import("../configure/output.js")
    >("../configure/output.js");
    return {
      ...actual,
      admitConfigureACK(
        this: unknown,
        ...args: Parameters<typeof actual.admitConfigureACK>
      ) {
        const result = Reflect.apply(
          actual.admitConfigureACK,
          this,
          args,
        ) as ReturnType<typeof actual.admitConfigureACK>;
        state.admissions++;
        state.admitted = result;
        if (d.controlCase === "L01-output-abort") {
          state.outputAborts++;
          throw Error(d.faults.output);
        }
        return result;
      },
    };
  });
  vi.doMock("../c10/configureEvents.js", async () => {
    const actual = await vi.importActual<
      typeof import("../c10/configureEvents.js")
    >("../c10/configureEvents.js");
    const { OWNER } = await import("../originalOwner.js");
    return {
      ...actual,
      createConfigureEventCompiler(
        this: unknown,
        ...args: Parameters<typeof actual.createConfigureEventCompiler>
      ) {
        let selected = args;
        if (d.controlCase === "L02-receipt-ACK-fault") {
          const options = data(args[1]);
          const send = options.send;
          assert(typeof send === "function");
          const faulted = {
            ...options,
            send(record: unknown, acknowledge: (value: unknown) => void) {
              const receipt = data(record).sequence === 3;
              const ack = receipt
                ? (value: unknown) => {
                    state.wrongACK++;
                    acknowledge({ ...data(value), binding: "wrong" });
                  }
                : acknowledge;
              return Reflect.apply(send, options, [record, ack]);
            },
          };
          selected = [args[0], faulted];
        }
        const compiler = Reflect.apply(
          actual.createConfigureEventCompiler,
          this,
          selected,
        ) as ReturnType<typeof actual.createConfigureEventCompiler>;
        const forwarded = {
          ...compiler,
          dispatch(...values: Parameters<typeof compiler.dispatch>) {
            return Reflect.apply(
              compiler.dispatch,
              compiler,
              values,
            ) as ReturnType<typeof compiler.dispatch>;
          },
          response(...values: Parameters<typeof compiler.response>) {
            return Reflect.apply(
              compiler.response,
              compiler,
              values,
            ) as ReturnType<typeof compiler.response>;
          },
          receipt(...values: Parameters<typeof compiler.receipt>) {
            state.receiptCalls++;
            const promise = Reflect.apply(
              compiler.receipt,
              compiler,
              values,
            ) as ReturnType<typeof compiler.receipt>;
            pending.push(
              promise.then(
                () => {
                  state.receiptFulfilled++;
                  if (d.controlCase === "L06-receipt-ACK-retire") {
                    state.retirements++;
                    OWNER.retire();
                  }
                },
                () => {
                  state.receiptRejected++;
                },
              ),
            );
            return promise;
          },
        };
        return Object.freeze(forwarded);
      },
    };
  });
  if (d.controlCase === "L03-final-discard-abort")
    vi.doMock("../configure/transport.js", async () => {
      const actual = await vi.importActual<
        typeof import("../configure/transport.js")
      >("../configure/transport.js");
      return {
        ...actual,
        createConfigureWriteTransport(
          this: unknown,
          ...args: Parameters<typeof actual.createConfigureWriteTransport>
        ) {
          const pair = Reflect.apply(
            actual.createConfigureWriteTransport,
            this,
            args,
          ) as ReturnType<typeof actual.createConfigureWriteTransport>;
          state.factoryPairs++;
          const capability = Object.fromEntries(
            Object.entries(pair.capability).map(([key, method]) => [
              key,
              (...values: unknown[]) => {
                if (key !== "discardFulfilledQuarantine") {
                  const result: unknown = Reflect.apply(
                    method,
                    pair.capability,
                    values,
                  );
                  if (key === "assertSourceOperationBinding" && result === true)
                    state.sourceBindingTrue++;
                  if (key === "reserveAcquisition" && result === true)
                    state.reservationTrue++;
                  return result;
                }
                state.discardEntered++;
                assert.equal(values.length, 0);
                const result: unknown = Reflect.apply(
                  method,
                  pair.capability,
                  values,
                );
                assert.equal(result, undefined);
                state.discardCompleted++;
                throw Error(d.faults.discard);
              },
            ]),
          ) as typeof pair.capability;
          const wrapped = Object.freeze({
            ...pair,
            capability: Object.freeze(capability),
          });
          state.sameReadTransport =
            wrapped.transport === pair.transport &&
            wrapped.transport.readTransport === pair.transport.readTransport;
          return wrapped;
        },
      };
    });
  return {
    state,
    pending,
    async join() {
      await Promise.all(pending);
    },
    cleanup() {
      for (const path of [
        "../configure/output.js",
        "../c10/configureEvents.js",
        "../configure/transport.js",
        "../configure/actor.js",
        "../observation/record.js",
        "../../../renewalV2/observation.js",
      ])
        vi.doUnmock(path);
    },
  };
}
