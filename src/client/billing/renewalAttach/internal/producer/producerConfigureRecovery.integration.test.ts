import { expect } from "vitest";
import {
  configureAdmissionCase,
  admissionControls,
  prepareAdmittedConfigure as prepare,
} from "../test-fixtures/producerConfigureAdmission.js";
import {
  captureAdmittedConfigureWrite,
  readAdmittedConfigureAcknowledgement,
} from "./configureWrite.js";
import { captureAdmittedConfigureRecovery } from "./configureRecovery.js";
import { object } from "./configureJournalData.js";

let rejectPost = false;
configureAdmissionCase(
  "explicit unknown replay reuses exact C7 and original Owner then returns actual ACK custody",
  async (h) => {
    const state = await prepare(h);
    rejectPost = true;
    await expect(
      captureAdmittedConfigureWrite(state.token).invoke(),
    ).rejects.toThrow("OWNED_CONFIGURE_PROVIDER_REJECTED");
    return state;
  },
  async (h, { token, child }) => {
    const before = h.calls.length;
    const actor = captureAdmittedConfigureRecovery(token);
    expect(actor).not.toBeNull();
    const output = await actor!.invoke();
    expect(object(output).status).toBe("configure_acknowledged");
    expect(readAdmittedConfigureAcknowledgement(token).output === output).toBe(
      true,
    );
    expect(
      h.calls.slice(before).filter((call) => call.method === "GET"),
    ).toHaveLength(6);
    expect(
      h.calls
        .filter(
          (call) =>
            call.method === "POST" &&
            call.path === child.record.configureRecord.request.path,
        )
        .map((call) => call.idempotencyKey),
    ).toEqual([
      child.record.configureRecord.request.key,
      child.record.configureRecord.request.key,
    ]);
    expect(await child.journal.readProviderAcknowledgement()).not.toBeNull();
    await expect(actor!.invoke()).rejects.toThrow();
    expect(admissionControls.legacy).toBe(0);
  },
  {
    beforeFetch: async (path, method) => {
      if (
        rejectPost &&
        method === "POST" &&
        path.startsWith("/v1/subscription_schedules/")
      ) {
        rejectPost = false;
        throw Error("CONTROLLED_UNKNOWN_POST");
      }
    },
  },
);
let responseFault = false,
  appends = 0;
configureAdmissionCase(
  "saved safe response resumes without provider calls after response append fails",
  async (h) => {
    const state = await prepare(h);
    responseFault = true;
    appends = 0;
    expect(
      object(await captureAdmittedConfigureWrite(state.token).invoke()).status,
    ).toBe("configure_unknown");
    return state;
  },
  async (h, { token, child }) => {
    const before = h.calls.length;
    const actor = captureAdmittedConfigureRecovery(token);
    expect(actor).not.toBeNull();
    const output = await actor!.invoke();
    expect(object(output).status).toBe("configure_acknowledged");
    expect(h.calls).toHaveLength(before);
    const view = readAdmittedConfigureAcknowledgement(token);
    expect(view.output === output).toBe(true);
    expect(view.receipt === object(output).receipt).toBe(true);
    expect(await child.journal.readProviderAcknowledgement()).not.toBeNull();
  },
  {
    beforeAppend: async () => {
      if (responseFault && ++appends === 2) {
        responseFault = false;
        throw Error("CONTROLLED_RESPONSE_APPEND_FAULT");
      }
    },
  },
);
