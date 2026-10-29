import { expect, it } from "vitest";
import { inspectRenewalScheduleMaterialV2 } from "../../index.js";
import { observationInput } from "../../../../tests/renewalObservation/fixtures.js";

it("retains a supplied terminal string as unsigned facts only", async () => {
  const raw = observationInput();
  raw.reads.schedule.status = "canceled";
  expect(await inspectRenewalScheduleMaterialV2(raw)).toMatchObject({
    predicate: "terminal_facts_only",
    providerStatus: "canceled",
    effectiveness: "unknown",
    acknowledgementEstablished: false,
    authenticationEstablished: false,
  });
});

it("does not coerce an array-shaped status into a known terminal fact", async () => {
  const raw = observationInput();
  (raw.reads.schedule as Record<string, unknown>).status = ["canceled"];
  let result;
  try {
    result = await inspectRenewalScheduleMaterialV2(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Invalid raw renewal observation.");
    return;
  }
  expect(["unknown", "conflict"]).toContain(result.predicate);
});

it.each([["canceled"], {}, null, 7, false])(
  "keeps malformed bare status %j outside terminal facts",
  async (status) => {
    const raw = observationInput();
    (raw.reads.schedule as Record<string, unknown>).status = status;
    expect(await inspectRenewalScheduleMaterialV2(raw)).toMatchObject({
      predicate: "unknown",
      reason: "invalid_schedule_status",
    });
  },
);
it("retains unknown string status disposition", async () => {
  const raw = observationInput();
  raw.reads.schedule.status = "future_provider_status";
  expect(await inspectRenewalScheduleMaterialV2(raw)).toMatchObject({
    predicate: "unknown",
    reason: "unsupported_schedule_status",
  });
});
