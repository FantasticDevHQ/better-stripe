import { object } from "./configureJournalData.js";
import { expect, it } from "vitest";
import {
  configureAdmissionFixture,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import { captureAdmittedConfigurePreflight } from "./configurePreflight.js";
import {
  captureAdmittedConfigureWrite,
  readAdmittedConfigureAcknowledgement,
  readAdmittedConfigureWriteAttempt,
} from "./configureWrite.js";

it("commits dispatch, one exact configure POST, retained C9 and receipt publication before returning ACK custody", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const child = await h.child();
    const token = await h.core.admitConfigure(child.fresh.call, child.journal);
    h.configureReads(child);
    admissionControls.preflight.push({
      originalEntry: admissionControls.entries[0],
      coversPreflight: () => true,
    });
    admissionControls.write.push({
      originalEntry: admissionControls.entries[0],
      coversConfigure: () => true,
    });
    await captureAdmittedConfigurePreflight(token).invoke();
    const before = h.calls.length;
    const actor = captureAdmittedConfigureWrite(token);
    expect(actor).not.toBeNull();
    const output = await actor!.invoke();
    expect(object(output).status).toBe("configure_acknowledged");
    const view = readAdmittedConfigureAcknowledgement(token);
    expect(view!.output === output).toBe(true);
    expect(view!.receipt === object(output).receipt).toBe(true);
    expect(view!.rawReceipt === object(output).rawReceipt).toBe(true);
    expect(view!.acknowledgement === h.core.attachAcknowledgement()).toBe(true);
    const calls = h.calls.slice(before);
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(6);
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      expect.objectContaining({
        path: child.record.configureRecord.request.path,
        idempotencyKey: child.record.configureRecord.request.key,
        apiVersion: "2026-09-30.endive",
      }),
    ]);
    if (child.fresh.result.disposition !== "acquired")
      throw Error("INVALID_FIXTURE_CAS");
    const history = await child.journal.readAttempt({
      attemptId: child.fresh.result.reservation.attemptId,
    });
    expect(history!.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    const retained = await child.journal.readProviderAcknowledgement();
    expect(retained).not.toBeNull();
    expect(JSON.parse(retained!.receiptJSON)).toEqual(object(output).receipt);
    expect(admissionControls.legacy).toBe(0);
  });
});

it("durably retains actual C9 even when whole-output admission fails", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const child = await h.child();
    const token = await h.core.admitConfigure(child.fresh.call, child.journal);
    h.configureReads(child);
    admissionControls.preflight.push({
      originalEntry: admissionControls.entries[0],
      coversPreflight: () => true,
    });
    admissionControls.write.push({
      originalEntry: admissionControls.entries[0],
      coversConfigure: () => true,
    });
    await captureAdmittedConfigurePreflight(token).invoke();
    Reflect.set(h.baseline.schedule, "padding", "x".repeat(300000));
    const actor = captureAdmittedConfigureWrite(token);
    expect(object(await actor.invoke()).status).toBe("configure_unknown");
    expect(await child.journal.readProviderAcknowledgement()).not.toBeNull();
    const attempt = readAdmittedConfigureWriteAttempt(token);
    expect(attempt).not.toBeNull();
    expect(attempt!.receiptKnown).toBe(true);
    expect(Object.isFrozen(attempt!.receipt)).toBe(true);
    expect(Object.isFrozen(attempt!.rawReceipt)).toBe(true);
    expect(attempt!.receipt).not.toBeNull();
    expect(attempt!.rawReceipt).not.toBeNull();
    expect(attempt!.returned).toBe(false);
    expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
    await expect(actor.invoke()).rejects.toThrow();
    expect(
      h.calls.filter(
        (call) =>
          call.method === "POST" &&
          call.path === child.record.configureRecord.request.path,
      ),
    ).toHaveLength(1);
  });
});
