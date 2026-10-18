// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import { authorizationFixture } from "./authorization.fixture.js";
import type { SettlementPolicyContext } from "../../shared/settlementPolicyContext.js";
import type { SettlementAuthorizationContext } from "./authorization.js";

afterEach(() => vi.restoreAllMocks());

const policyContext = {
  namespace: "host.sale-policy",
  version: 1 as const,
  fields: { planVersion: "plan-v3", originalOwner: "seller-original" },
};

it("retains ordinary public no-context settlement and the actual registered allocation", async () => {
  const f = await authorizationFixture();
  expect(await f.settle()).toMatchObject({
    status: "settled",
    executedTransfers: [{ amount: 940 }],
  });
  expect(await f.allocation()).toMatchObject({
    sourceChargeId: "ch_authorize",
    gross: 1000,
    transfers: [{ destinationAccountId: "acct_creator", amount: 940 }],
  });
  expect(f.transfers).toHaveLength(1);
});

it("persists opt-in policy context through actual component reserve and public read", async () => {
  const f = await authorizationFixture();
  const allocation = { ...f.options.allocation, policyContext };
  await expect(f.reserve(allocation)).resolves.toMatchObject({ policyContext });
  expect(await f.allocation()).toMatchObject({ policyContext });
  const reordered = {
    ...allocation,
    policyContext: {
      ...policyContext,
      fields: { originalOwner: "seller-original", planVersion: "plan-v3" },
    },
  };
  await expect(f.reserve(reordered)).resolves.toMatchObject({ policyContext });
  expect(f.transfers).toHaveLength(0);
});

it("includes the validated proposal context in initial public reserve admission before persistence", async () => {
  const f = await authorizationFixture();
  const contexts: SettlementAuthorizationContext[] = [];
  const input = {
    ...f.options,
    allocation: { ...f.options.allocation, policyContext },
    authorize: async (context: SettlementAuthorizationContext) => {
      if (contexts.length === 0) expect(await f.allocation()).toBeNull();
      contexts.push(context);
    },
  };
  const outcome = await f.settle(input).then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
  expect(contexts[0]).toMatchObject({
    phase: "reserve",
    settlement: { policyContext },
  });
  expect(outcome).toMatchObject({ result: { status: "settled" } });
  expect(contexts[1]).toMatchObject({
    phase: "transfer",
    settlement: { policyContext },
  });
  expect(await f.allocation()).toMatchObject({ policyContext });
  expect(f.transfers).toHaveLength(1);
});

it("rejects a changed or missing context without changing the first allocation", async () => {
  const f = await authorizationFixture();
  const allocation = { ...f.options.allocation, policyContext };
  const original = await f.reserve(allocation);
  for (const changed of [
    { ...policyContext, namespace: "foreign.policy" },
    {
      ...policyContext,
      fields: { ...policyContext.fields, planVersion: "v4" },
    },
    undefined,
  ]) {
    await expect(
      f.reserve({ ...allocation, policyContext: changed }),
    ).rejects.toThrow(/policy context/i);
    expect(await f.allocation()).toEqual(original);
  }
  expect(f.transfers).toHaveLength(0);
});

it("never backfills a legacy allocation with a new context", async () => {
  const f = await authorizationFixture();
  const original = await f.reserve(f.options.allocation);
  await expect(
    f.reserve({ ...f.options.allocation, policyContext }),
  ).rejects.toThrow(/policy context/i);
  expect(await f.allocation()).toEqual(original);
});

it("rejects oversized context at public entry before any synthetic provider request", async () => {
  const f = await authorizationFixture();
  const fields = Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => [`key${i}`, "x".repeat(512)]),
  );
  await expect(
    f.settle({
      ...f.options,
      allocation: {
        ...f.options.allocation,
        policyContext: { ...policyContext, fields },
      },
    }),
  ).rejects.toThrow(/policy context/i);
  expect(f.requests).toHaveLength(0);
  expect(await f.allocation()).toBeNull();
});

it("keeps the actual concurrent winner's context and prevents a losing request's POST", async () => {
  const f = await authorizationFixture();
  const other = { ...policyContext, fields: { planVersion: "winner" } };
  const input = {
    ...f.options,
    allocation: { ...f.options.allocation, policyContext },
    authorize: async (context: SettlementAuthorizationContext) => {
      if (context.phase === "reserve")
        await f.reserve({ ...f.options.allocation, policyContext: other });
    },
  };
  await expect(f.settle(input)).rejects.toThrow(/policy context/i);
  expect(await f.allocation()).toMatchObject({ policyContext: other });
  expect(f.transfers).toHaveLength(0);
});

it("detaches nested context so callback mutation cannot alter the saved claim", async () => {
  const f = await authorizationFixture();
  const seen: SettlementAuthorizationContext[] = [];
  const input = {
    ...f.options,
    allocation: { ...f.options.allocation, policyContext },
    authorize: async (context: SettlementAuthorizationContext) => {
      seen.push(structuredClone(context));
      const copy = context.settlement;
      if ("policyContext" in copy && copy.policyContext)
        Object.assign(copy.policyContext.fields, { planVersion: "attacker" });
    },
  };
  expect(await f.settle(input)).toMatchObject({
    status: "settled",
    policyContext,
  });
  expect(await f.allocation()).toMatchObject({ policyContext });
  expect(seen).toHaveLength(2);
  for (const context of seen)
    expect(context.settlement).toMatchObject({ policyContext });
});

it("resumes only the missing leg with its original context after current policy changes", async () => {
  const f = await authorizationFixture(true);
  f.stopAfterFirst();
  const input = {
    ...f.options,
    allocation: { ...f.options.allocation, policyContext },
    authorize: async () => f.authorize(),
  };
  await expect(f.settle(input)).rejects.toThrow(
    "Host settlement authorization denied",
  );
  expect(f.transfers).toHaveLength(1);
  f.allow();
  await expect(
    f.settle({
      ...input,
      allocation: {
        ...input.allocation,
        policyContext: {
          ...policyContext,
          fields: { planVersion: "today-v4" },
        },
      },
    }),
  ).rejects.toThrow(/policy context/i);
  expect(f.transfers).toHaveLength(1);
  expect(await f.settle(input)).toMatchObject({
    status: "settled",
    policyContext,
  });
  expect(f.transfers).toHaveLength(2);
});

const invalidContexts: SettlementPolicyContext[] = [
  { ...policyContext, fields: { $reserved: "value" } },
  { ...policyContext, fields: { "line\nbreak": "value" } },
  { ...policyContext, fields: { é: "value" } },
  { ...policyContext, namespace: "" },
  { ...policyContext, namespace: "n".repeat(81) },
  { ...policyContext, fields: { "": "value" } },
  { ...policyContext, fields: { ["k".repeat(65)]: "value" } },
  { ...policyContext, fields: { key: "v".repeat(513) } },
  {
    ...policyContext,
    fields: Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`k${i}`, "v"]),
    ),
  },
  {
    ...policyContext,
    fields: Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`k${i}`, "€".repeat(512)]),
    ),
  },
];
it.each(invalidContexts)(
  "rejects invalid context before public I/O and raw component persistence %#",
  async (invalid) => {
    const f = await authorizationFixture();
    const allocation = { ...f.options.allocation, policyContext: invalid };
    await expect(f.settle({ ...f.options, allocation })).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
    await expect(f.reserve(allocation)).rejects.toThrow();
    expect(await f.allocation()).toBeNull();
  },
);

it("accepts valid maximum field/key/value bounds and an exactly 8 KiB canonical envelope", async () => {
  const f = await authorizationFixture();
  const bounded = {
    namespace: "n".repeat(80),
    version: 1 as const,
    fields: Object.fromEntries(
      Array.from({ length: 32 }, (_, i) => [String(i).padEnd(64, "k"), "v"]),
    ),
  };
  await expect(
    f.reserve({ ...f.options.allocation, policyContext: bounded }),
  ).resolves.toMatchObject({ policyContext: bounded });
  const g = await authorizationFixture();
  const fields: Record<string, string> = Object.fromEntries(
    Array.from({ length: 15 }, (_, i) => [`k${i}`, "v".repeat(512)]),
  );
  fields.last = "";
  const exact = { namespace: "host", version: 1 as const, fields };
  const bytes = new TextEncoder().encode(JSON.stringify(exact)).byteLength;
  fields.last = "v".repeat(8192 - bytes);
  expect(fields.last.length).toBeLessThanOrEqual(512);
  expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength).toBe(8192);
  await expect(
    g.reserve({ ...g.options.allocation, policyContext: exact }),
  ).resolves.toMatchObject({ policyContext: exact });
});

it.each([
  Object.assign(new Date(0), policyContext),
  null,
  { ...policyContext, version: 2 },
  { ...policyContext, namespace: 42 },
  { ...policyContext, extra: "not in the envelope" },
  { ...policyContext, fields: [] },
  { ...policyContext, fields: { planVersion: 42 } },
  { ...policyContext, fields: new Date(0) },
])(
  "rejects malformed JavaScript context before I/O without relying on TypeScript %#",
  async (raw) => {
    const f = await authorizationFixture();
    // Reflect invokes the actual JS boundary with malformed values, without changing public types.
    const allocation = { ...f.options.allocation, policyContext: raw };
    await expect(
      Reflect.apply(f.settle, undefined, [{ ...f.options, allocation }]),
    ).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
    await expect(
      Reflect.apply(f.reserve, undefined, [allocation]),
    ).rejects.toThrow();
    expect(await f.allocation()).toBeNull();
  },
);
