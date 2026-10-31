import { expect, it, vi } from "vitest";
import {
  admissionControls,
  configureAdmissionFixture,
} from "../test-fixtures/producerConfigureAdmission.js";
import { data } from "../test-fixtures/attachScenarioBarriers.js";
import { readConfigureLineage } from "./configureLineage.js";

it.each(["initial", "replay", "resume"] as const)(
  "admits an actual configure CAS against the actual %s parent and binds its original basis",
  async (path) => {
    await configureAdmissionFixture(async (h) => {
      const output = await h.complete(path);
      expect(data(output).status).toBe("attach_acknowledged");
      const actualACK = h.core.attachAcknowledgement();
      expect(actualACK.output).toBe(output);
      const child = await h.child();
      const before = await child.journal.loadAuthorizedOperation();
      expect(
        before && "initialBasis" in before ? before.initialBasis : "missing",
      ).toBeNull();
      const admit = Reflect.get(h.core, "admitConfigure");
      expect(typeof admit).toBe("function");
      const selectors = admissionControls.selectors;
      const calls = h.calls.length;
      const admitted = data(
        await Reflect.apply(admit, h.core, [child.fresh.call, child.journal]),
      );
      expect(admitted.owner).toBe(h.core.owner);
      expect(admitted.basisJSON).toBe(h.core.basisJSON);
      expect(admitted.operationalAuthority).toBe(false);
      expect(Object.keys(admitted).sort()).toEqual([
        "basisJSON",
        "operationalAuthority",
        "owner",
      ]);
      const bound = await child.journal.loadAuthorizedOperation();
      expect(
        bound && "initialBasis" in bound ? bound.initialBasis : "missing",
      ).toEqual({
        version: 1,
        stage: "configure",
        attemptId:
          child.fresh.result.disposition === "acquired"
            ? child.fresh.result.reservation.attemptId
            : "invalid",
        sourcePayloadId:
          child.fresh.result.disposition === "acquired"
            ? child.fresh.result.reservation.payloadId
            : "invalid",
        policyJSON: JSON.stringify(
          child.record.timingPolicy,
          Object.keys(child.record.timingPolicy).sort(),
        ),
        basisJSON: h.core.basisJSON,
      });
      expect(admissionControls.selectors).toBe(selectors);
      expect(h.calls).toHaveLength(calls);
      expect(admissionControls.legacy).toBe(0);
    });
  },
);

it("admits a child through a different actual Action receiver on the same checked SDK root", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const selectors = admissionControls.selectors;
    await h.inAnotherAction(async (ctx) => {
      expect(ctx).not.toBe(h.ctx);
      const child = await h.child({ ctx });
      const admitted = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      expect(admitted.owner).toBe(h.core.owner);
      expect(admitted.basisJSON).toBe(h.core.basisJSON);
    });
    expect(admissionControls.selectors).toBe(selectors);
  });
});
it("keeps concurrent children distinct while retaining exact parent Owner and selected client", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const [one, two] = await Promise.all([h.child(), h.child()]);
    const selectors = admissionControls.selectors;
    const calls = h.calls.length;
    const [first, second] = await Promise.all([
      h.core.admitConfigure(one.fresh.call, one.journal),
      h.core.admitConfigure(two.fresh.call, two.journal),
    ]);
    expect(first).not.toBe(second);
    expect(() => readConfigureLineage({ ...first })).toThrow(
      "CONFIGURE_ADMISSION_UNBOUND",
    );
    expect(first.owner).toBe(h.core.owner);
    expect(second.owner).toBe(h.core.owner);
    const a = readConfigureLineage(first),
      b = readConfigureLineage(second);
    expect(a.parent).toBe(b.parent);
    expect(a.parent.client).toBe(b.parent.client);
    expect(a.parent.originAssociation).toBe(b.parent.originAssociation);
    expect(a.reservation.operationId).not.toBe(b.reservation.operationId);
    expect(a.reservation.attemptId).not.toBe(b.reservation.attemptId);
    expect(a.reservation.key).not.toBe(b.reservation.key);
    expect(a.originalReservation).toBe(
      one.fresh.result.disposition === "acquired"
        ? one.fresh.result.reservation
        : null,
    );
    expect(b.originalReservation).toBe(
      two.fresh.result.disposition === "acquired"
        ? two.fresh.result.reservation
        : null,
    );
    expect(a.journal).toBe(one.journal);
    expect(b.journal).toBe(two.journal);
    expect(h.calls).toHaveLength(calls);
    expect(admissionControls.selectors).toBe(selectors);
  });
});

it("isolates concurrent configure admission and retirement across two actual SDK roots", async () => {
  const states = new Map<number, ReturnType<typeof readConfigureLineage>>();
  let release!: () => void, retired!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    retired = resolve;
  });
  await configureAdmissionFixture(
    async (h) => {
      await h.complete();
      const child = await h.child();
      const admitted = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      states.set(h.index, readConfigureLineage(admitted));
      if (states.size === 2) release();
      await ready;
      const own = states.get(h.index)!,
        other = states.get(1 - h.index)!;
      expect(own.owner).toBe(h.core.owner);
      expect(own.owner === other.owner).toBe(false);
      expect(own.parent.client === other.parent.client).toBe(false);
      expect(
        own.parent.originAssociation === other.parent.originAssociation,
      ).toBe(false);
      expect(own.parentToken === other.parentToken).toBe(false);
      expect(own.reservation.operationId).not.toBe(
        other.reservation.operationId,
      );
      if (h.index === 0) {
        h.core.owner.retire();
        retired();
      } else {
        await closed;
        expect(() => h.core.owner.check()).not.toThrow();
      }
    },
    {
      count: 2,
      keys: [
        "sk_test_invalid_configure_root_a",
        "sk_test_invalid_configure_root_b",
      ],
    },
  );
});

it("refuses forged child calls before clock reads and preserves the genuine unspent handle", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const child = await h.child();
    const wall = vi.spyOn(Date, "now");
    const monotonic = vi.mocked(process.hrtime.bigint);
    let traps = 0;
    for (const call of [
      null,
      {},
      new Proxy(child.fresh.call!, {
        get() {
          traps++;
          throw Error("PROXY_INVOKED");
        },
      }),
    ]) {
      const beforeWall = wall.mock.calls.length,
        beforeMono = monotonic.mock.calls.length;
      const pending = h.core.admitConfigure(call, child.journal);
      const afterWall = wall.mock.calls.length,
        afterMono = monotonic.mock.calls.length;
      await expect(pending).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
      expect(afterWall - beforeWall).toBe(0);
      expect(afterMono - beforeMono).toBe(0);
    }
    expect(traps).toBe(0);
    const before = monotonic.mock.calls.length;
    await h.core.admitConfigure(child.fresh.call, child.journal);
    expect(monotonic.mock.calls.length).toBeGreaterThan(before);
  });
});
