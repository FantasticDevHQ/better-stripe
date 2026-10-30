import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

vi.mock("./ownerBinding.js", () => ({
  SOURCE_OWNER: {
    basis: Object.freeze({
      startWallMs: 1000,
      startNs: 1_000_000_000n,
      workEndWallMs: 181000,
      workEndNs: 181_000_000_000n,
      endWallMs: 211000,
      endNs: 211_000_000_000n,
    }),
    check: () => ({ wallMs: 1000, ns: 1_000_000_000n }),
    subscribe: () => () => {},
  },
}));

it("a live internal append records the exact canonical envelope after send AND ACK", async () => {
  const { createAppendAckAdapter } = await import("./appendAck.js");
  const records: unknown[] = [];
  const append = createAppendAckAdapter({
    timeoutMs: 5000,
    send(
      record: { sequence: number; binding: string },
      ack: (value: unknown) => void,
    ) {
      records.push(record);
      ack({ sequence: record.sequence, binding: record.binding });
      return Promise.resolve();
    },
  });
  // Captured primitive nodes only. No constructor, Owner or digest is supplied by options.
  const operation = append({
    kind: "object",
    entries: [["event", { kind: "scalar", value: "synthetic" }]],
  });
  const outcome = await operation.then(
    () => "fulfilled",
    () => "rejected",
  );
  expect(outcome).toBe("fulfilled");
  const data = { event: "synthetic" };
  const expected = createHash("sha256")
    .update(
      JSON.stringify([
        "betterstripe-renewal-binding",
        2,
        "unbound-qualification-event",
        { data, sequence: 1 },
      ]),
    )
    .digest("hex");
  expect(records).toEqual([
    {
      sequence: 1,
      binding: `unbound-qualification-event:v2:sha256:${expected}`,
      data,
    },
  ]);
});

it("rejects an invalid captured node tag rather than encoding it as an object", async () => {
  const { encode } = await import("./eventCodec.js");
  expect(() => encode({ kind: "invalid", entries: [] } as never)).toThrow(
    "C10_SOURCE_STOP",
  );
});

it("preserves the captured own-data send receiver", async () => {
  const { createAppendAckAdapter } = await import("./appendAck.js");
  let receiverPrototype: unknown = "not called";
  const append = createAppendAckAdapter({
    timeoutMs: 5000,
    send(
      this: unknown,
      record: { sequence: number; binding: string },
      ack: (value: unknown) => void,
    ) {
      receiverPrototype = Object.getPrototypeOf(this);
      ack({ sequence: record.sequence, binding: record.binding });
    },
  });
  await append({ kind: "scalar", value: null });
  expect(receiverPrototype).toBe(null);
});
