import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { witnessFixture } from "../../../tests/renewalObservation/witnessFixtures.js";
import { canonicalConfigure } from "../renewalOperations/configureJournal.fixtures.js";

// Test-only routing names do not stand in for genuine generated production references.
const retain = makeFunctionReference<"mutation">(
  "renewalWitnesses/mutations:retainAuthorizedWitness",
);
const read = makeFunctionReference<"query">(
  "renewalWitnesses/queries:readAuthorizedWitness",
);

describe("registered renewal witness component boundaries", () => {
  it.each([false, true])(
    "retains and reads complete immutable material with captured C9 %s",
    async (retained) => {
      const h = await witnessFixture(retained);
      const payloadJSON = canonicalConfigure(h.payload);
      const args = { identity: h.identity, payloadJSON };
      const first = await h.t.mutation(retain, args);
      expect(first.status).toBe("retained");
      expect(first.descriptor.identity).toEqual(h.identity);
      expect(first.descriptor.publicDeliveryEstablished).toBe(false);
      expect(await h.t.mutation(retain, args)).toEqual(first);
      expect(await h.t.query(read, { identity: h.identity })).toEqual({
        descriptor: first.descriptor,
        payloadJSON,
      });
      const altered = structuredClone(h.payload);
      altered.capturedSubject = "another-captured-subject";
      expect(
        await h.t.mutation(retain, {
          identity: h.identity,
          payloadJSON: canonicalConfigure(altered),
        }),
      ).toEqual({ status: "conflict", reason: "identity_changed" });
      expect(await h.t.query(read, { identity: h.identity })).toEqual({
        descriptor: first.descriptor,
        payloadJSON,
      });
      expect(h.fetches()).toBe(0);
    },
  );

  it("rejects unknown identity fields and malformed operation IDs before storage", async () => {
    const h = await witnessFixture();
    const payloadJSON = canonicalConfigure(h.payload);
    await expect(
      h.t.mutation(retain, {
        identity: { ...h.identity, extra: "not-admitted" },
        payloadJSON,
      }),
    ).rejects.toThrow(/Validator error/);
    await expect(
      h.t.mutation(retain, {
        identity: { ...h.identity, operationId: "not-a-convex-id" },
        payloadJSON,
      }),
    ).rejects.toThrow(/Validator error/);
    expect(
      await h.t.run((ctx) =>
        ctx.db.query("renewalObservationWitnesses").take(2),
      ),
    ).toEqual([]);
  });

  it("rejects unknown outer arguments and noncanonical payloads without inserting", async () => {
    const h = await witnessFixture();
    const args = {
      identity: h.identity,
      payloadJSON: canonicalConfigure(h.payload),
    };
    await expect(
      h.t.mutation(retain, { ...args, extra: true }),
    ).rejects.toThrow(/Validator error/);
    await expect(
      h.t.mutation(retain, {
        ...args,
        payloadJSON: JSON.stringify(h.payload, null, 2),
      }),
    ).rejects.toThrow("RENEWAL_WITNESS_INVALID");
    expect(
      await h.t.run((ctx) =>
        ctx.db.query("renewalObservationWitnesses").take(2),
      ),
    ).toEqual([]);
  });

  it("releases no payload for another installation or operation identity", async () => {
    const h = await witnessFixture();
    await h.t.mutation(retain, {
      identity: h.identity,
      payloadJSON: canonicalConfigure(h.payload),
    });
    for (const identity of [
      { ...h.identity, componentScope: "another-installation" },
      {
        ...h.identity,
        operationId: h.identity.parentOperationId,
        parentOperationId: h.identity.operationId,
      },
      { ...h.identity, witnessId: "another-witness" },
    ]) {
      expect(await h.t.query(read, { identity })).toBeNull();
    }
    await expect(
      h.t.query(read, { identity: { ...h.identity, extra: true } }),
    ).rejects.toThrow(/Validator error/);
    await expect(
      h.t.query(read, { identity: h.identity, extra: true }),
    ).rejects.toThrow(/Validator error/);
    expect(h.fetches()).toBe(0);
  });

  it("revalidates material behind a rehashed corrupt row without repairing it", async () => {
    const h = await witnessFixture();
    const args = {
      identity: h.identity,
      payloadJSON: canonicalConfigure(h.payload),
    };
    const first = await h.t.mutation(retain, args);
    const changed = structuredClone(h.payload);
    Object.assign(changed.reads.subscription, { cancel_at_period_end: true });
    const payloadJSON = canonicalConfigure(changed);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("renewal-witness:v1\u0000" + payloadJSON),
    );
    const hex = [...new Uint8Array(hash)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const payloadBinding = "renewal-witness:v1:sha256:" + hex;
    await h.t.run((ctx) =>
      ctx.db.patch(
        "renewalObservationWitnesses",
        first.descriptor.witnessRowId,
        { payloadJSON, payloadBinding },
      ),
    );
    await expect(h.t.query(read, { identity: h.identity })).rejects.toThrow(
      "RENEWAL_WITNESS_INVALID",
    );
    await expect(h.t.mutation(retain, args)).rejects.toThrow(
      "RENEWAL_WITNESS_INVALID",
    );
    const row = await h.t.run((ctx) =>
      ctx.db.get("renewalObservationWitnesses", first.descriptor.witnessRowId),
    );
    expect(row?.payloadJSON).toBe(payloadJSON);
    expect(row?.payloadBinding).toBe(payloadBinding);
    expect(h.fetches()).toBe(0);
  });
});
