import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalConfigure,
  configureComponentFixture,
} from "./configureJournal.fixtures.js";

afterEach(() => vi.unstubAllGlobals());
it("creates a separately authorized V2 configure operation only after its complete parent attachment DATA", async () => {
  const h = await configureComponentFixture();
  const created = await h.t.mutation(h.create, h.createArgs);
  expect(created.status).toBe("created");
  expect(created.operationId).not.toBe(h.parentCreated.operationId);
  expect(await h.t.query(h.load, { operationId: created.operationId })).toEqual(
    {
      recordVersion: 2,
      operationId: created.operationId,
      recordJSON: h.createArgs.recordJSON,
      revision: 0,
      activeAttempt: null,
      initialBasis: null,
    },
  );
  expect(h.fetches()).toBe(0);
});

it.each([
  "missing-parent",
  "wrong-attempt",
  "wrong-source",
  "changed-bundle",
  "extended-cutoff",
  "shortened-cutoff",
  "unpublished-parent",
])(
  "rejects configure parent-link %s before inserting child DATA",
  async (scenario) => {
    const h = await configureComponentFixture(
      scenario !== "unpublished-parent",
    );
    const raw = JSON.parse(h.createArgs.recordJSON);
    switch (scenario) {
      case "missing-parent":
        raw.parentAttachment.operationId = "missing-parent-operation";
        break;
      case "wrong-attempt":
        raw.parentAttachment.attemptId = h.parentCreated.operationId;
        break;
      case "wrong-source":
        raw.parentAttachment.sourcePayloadId = h.parentCreated.operationId;
        break;
      case "changed-bundle":
        raw.configureRecord.originalBundle.future = ["changed"];
        break;
      case "extended-cutoff":
        raw.timingPolicy.workEndWallMs++;
        break;
      case "shortened-cutoff":
        raw.timingPolicy.workEndWallMs--;
        break;
    }
    const before = await h.t.run((ctx) =>
      ctx.db.query("renewalOperations").take(3),
    );
    await expect(
      h.t.mutation(h.create, {
        ...h.createArgs,
        recordJSON: canonicalConfigure(raw),
      }),
    ).rejects.toThrow("RENEWAL_JOURNAL_CONFLICT");
    expect(
      await h.t.run((ctx) => ctx.db.query("renewalOperations").take(3)),
    ).toEqual(before);
    expect(h.fetches()).toBe(0);
  },
);
