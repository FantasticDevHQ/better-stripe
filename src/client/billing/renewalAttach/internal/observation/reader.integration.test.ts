import { expect, it, vi } from "vitest";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import {
  prepareObservationReader,
  observerIdentity,
  authorizeObservation,
  readerControls,
} from "../test-fixtures/observationReader.js";
import { captureAuthorizedObservationHistoryReader } from "./reader.js";
configureAdmissionCase(
  "fresh authenticated query-only reader survives original write retirement and period boundary",
  prepareObservationReader,
  async (h, state) => {
    const calls = h.calls.length,
      selectors = admissionControls.selectors;
    await h.inAnotherAction(async (ctx) => {
      const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      expect(Object.keys(reader)).toEqual(["read"]);
      const output = await reader.read();
      expect(output.status).toBe("authorized_observation_history_data");
      expect(output.history.snapshot).toEqual(state.full);
      expect(output.authorization.authorizationRevision).toBe(3);
      expect(output.operationalAuthority).toBe(false);
      expect(Object.isFrozen(output.history.record)).toBe(true);
      await expect(reader.read()).rejects.toThrow();
    });
    expect(readerControls.authorizations).toBe(2);
    expect(h.calls).toHaveLength(calls);
    expect(admissionControls.selectors).toBe(selectors);
    expect(admissionControls.legacy).toBe(0);
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
it("EMPTY observation history profile refuses before root/input/clock reflection", async () => {
  admissionControls.history.splice(0);
  let traps = 0;
  const root = new Proxy(
    {},
    {
      getPrototypeOf() {
        traps++;
        throw Error("TRAP");
      },
    },
  );
  const input = new Proxy(
    {},
    {
      ownKeys() {
        traps++;
        throw Error("TRAP");
      },
    },
  );
  const wall = vi.spyOn(Date, "now"),
    ns = vi.spyOn(process.hrtime, "bigint");
  wall.mockClear();
  ns.mockClear();
  await expect(
    captureAuthorizedObservationHistoryReader(root, input),
  ).rejects.toThrow("OBSERVATION_HISTORY_READER_UNBOUND");
  expect(traps).toBe(0);
  expect(wall).not.toHaveBeenCalled();
  expect(ns).not.toHaveBeenCalled();
});
configureAdmissionCase(
  "reader consumes before concurrent calls and exposes only four fixed query routes",
  prepareObservationReader,
  async (h, state) => {
    await h.inAnotherAction(async (ctx) => {
      const queries = vi.spyOn(ctx, "runQuery"),
        mutations = vi.spyOn(ctx, "runMutation");
      const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const first = reader.read();
      await expect(reader.read()).rejects.toThrow();
      expect((await first).status).toBe("authorized_observation_history_data");
      expect(mutations).not.toHaveBeenCalled();
      expect(queries).toHaveBeenCalledTimes(14);
    });
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
