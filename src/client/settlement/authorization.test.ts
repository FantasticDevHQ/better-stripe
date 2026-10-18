// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import { authorizationFixture } from "./authorization.fixture.js";
import type { SettlementAuthorizationContext } from "./authorization.js";

afterEach(() => vi.restoreAllMocks());

it("retains the public no-hook settlement and registered component ledger", async () => {
  const f = await authorizationFixture();
  expect(await f.settle()).toMatchObject({
    status: "settled",
    executedTransfers: [{ amount: 940 }],
  });
  expect(f.transfers).toHaveLength(1);
  expect(await f.allocation()).toMatchObject({
    sourceChargeId: "ch_authorize",
    gross: 1000,
  });
});

it("denies admission before an allocation or transfer when the host hook rejects", async () => {
  const f = await authorizationFixture();
  f.revoke();
  await expect(
    f.settle({ ...f.options, authorize: async () => f.authorize() }),
  ).rejects.toThrow("Host settlement authorization denied");
  expect(await f.allocation()).toBeNull();
  expect(f.transfers).toHaveLength(0);
});

it("reauthorizes after provider source reads before admitting allocation", async () => {
  const f = await authorizationFixture();
  f.pauseRead("payment");
  const pending = f.settle({
    ...f.options,
    authorize: async () => f.authorize(),
  });
  await f.reachedRead;
  f.revoke();
  f.release();
  await expect(pending).rejects.toThrow("Host settlement authorization denied");
  expect(await f.allocation()).toBeNull();
  expect(f.transfers).toHaveLength(0);
});

it("reauthorizes after transfer reconciliation immediately before new money dispatch", async () => {
  const f = await authorizationFixture();
  f.pauseRead("history");
  const pending = f.settle({
    ...f.options,
    authorize: async () => f.authorize(),
  });
  await f.reachedRead;
  f.revoke();
  f.release();
  await expect(pending).rejects.toThrow("Host settlement authorization denied");
  expect(f.transfers).toHaveLength(0);
  expect(await f.allocation()).toMatchObject({ gross: 1000 });
});

it("stops later legs on denial and retries only missing legs under the frozen allocation", async () => {
  const f = await authorizationFixture(true);
  f.stopAfterFirst();
  const contexts: SettlementAuthorizationContext[] = [];
  const authorize = async (context: SettlementAuthorizationContext) => {
    contexts.push(context);
    f.authorize();
  };
  await expect(f.settle({ ...f.options, authorize })).rejects.toThrow(
    "Host settlement authorization denied",
  );
  expect(f.transfers).toHaveLength(1);
  f.allow();
  await f.settle({
    ...f.options,
    allocation: {
      ...f.options.allocation,
      platformNet: 100,
      transfers: [
        { destinationAccountId: "acct_changed", role: "store", amount: 840 },
      ],
    },
    authorize,
  });
  expect(f.transfers).toHaveLength(2);
  expect(f.transfers.map((t) => t.destination)).toEqual([
    "acct_creator",
    "acct_other",
  ]);
  expect(
    contexts
      .filter((c) => c.phase === "transfer")
      .map((c) => c.transfer.destinationAccountId),
  ).toEqual(["acct_creator", "acct_other", "acct_other"]);
  expect(
    contexts
      .filter((c) => c.phase === "reserve")
      .map((c) => c.settlement.platformNet),
  ).toEqual([0, 0]);
});

it("checks the actual saved foreign leg when another reservation wins after admission", async () => {
  const f = await authorizationFixture();
  const authorize = async (context: SettlementAuthorizationContext) => {
    if (context.phase === "reserve") {
      await f.reserve({
        ...f.options.allocation,
        transfers: [
          { destinationAccountId: "acct_foreign", role: "store", amount: 940 },
        ],
      });
    } else if (context.transfer.destinationAccountId !== "acct_creator") {
      throw new Error("Host rejected actual foreign recipient");
    }
  };
  await expect(f.settle({ ...f.options, authorize })).rejects.toThrow(
    "Host rejected actual foreign recipient",
  );
  expect(f.transfers).toHaveLength(0);
  expect(await f.allocation()).toMatchObject({
    transfers: [{ destinationAccountId: "acct_foreign" }],
  });
});

it("recovers known provider success without invoking another new-money hook or POST", async () => {
  const f = await authorizationFixture();
  f.failLedger();
  const authorize = vi.fn(async () => {});
  await expect(f.settle({ ...f.options, authorize })).rejects.toThrow(
    "Synthetic ledger write failure",
  );
  expect(f.transfers).toHaveLength(1);
  authorize.mockClear();
  expect(await f.settle({ ...f.options, authorize })).toMatchObject({
    status: "settled",
  });
  expect(f.transfers).toHaveLength(1);
  expect(authorize.mock.calls).toHaveLength(1);
  expect(authorize).toHaveBeenCalledWith(
    expect.objectContaining({ phase: "reserve" }),
  );
});

it("detaches authorization snapshots so callback mutation cannot change financial inputs", async () => {
  const f = await authorizationFixture();
  const authorize = async (context: SettlementAuthorizationContext) => {
    Object.assign(context.settlement, { platformNet: 500 });
    if (context.phase === "reserve")
      Object.assign(context.settlement.transfers[0], { amount: 1 });
    else
      Object.assign(context.transfer, {
        amount: 1,
        destinationAccountId: "acct_foreign",
      });
  };
  expect(await f.settle({ ...f.options, authorize })).toMatchObject({
    platformNet: 0,
    executedTransfers: [{ amount: 940, destinationAccountId: "acct_creator" }],
  });
});
