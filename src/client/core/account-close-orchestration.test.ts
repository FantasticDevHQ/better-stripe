// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { closeAccount, restartAccountOnboarding } from "./accounts.js";

function makeStripe() {
  return { v2: { core: { accounts: { close: vi.fn(), retrieve: vi.fn() } } } };
}
function asStripe(stripe: ReturnType<typeof makeStripe>) {
  return stripe as unknown as Stripe;
}
function makeComponent() {
  return {
    accountClosure: {
      mutations: {
        prepare: refFor("accountClosure/mutations/prepare"),
        complete: refFor("accountClosure/mutations/complete"),
      },
    },
  } as unknown as Component;
}
function refFor(path: string) {
  return { [Symbol.for("toReferencePath")]: `betterStripe/${path}` };
}

describe("closeAccount / restartAccountOnboarding", () => {
  function context(appliedConfigurations?: string[], state = "pending") {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        closure: { appliedConfigurations, state },
        isRetry: false,
      })
      .mockResolvedValue(null);
    return { ctx: { runMutation } as unknown as RunCtx, runMutation };
  }

  it("pins stored configurations before close and completes without deleting provenance", async () => {
    const stripe = makeStripe();
    const { ctx, runMutation } = context(["merchant", "recipient"]);
    expect(
      await closeAccount(asStripe(stripe), makeComponent(), ctx, {
        stripeAccountId: "acct_close",
      }),
    ).toEqual({ closed: true });
    expect(stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled();
    expect(stripe.v2.core.accounts.close).toHaveBeenCalledWith(
      "acct_close",
      { applied_configurations: ["merchant", "recipient"] },
      { idempotencyKey: "betterstripe-close:acct_close" },
    );
    expect(runMutation.mock.calls.map((call) => call[0])).toEqual([
      refFor("accountClosure/mutations/prepare"),
      refFor("accountClosure/mutations/complete"),
    ]);
  });

  it("retrieves configurations when none were stored", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue({
      applied_configurations: ["merchant"],
    });
    const { ctx } = context();
    await closeAccount(asStripe(stripe), makeComponent(), ctx, {
      stripeAccountId: "acct_fallback",
    });
    expect(stripe.v2.core.accounts.close).toHaveBeenCalledWith(
      "acct_fallback",
      { applied_configurations: ["merchant"] },
      { idempotencyKey: "betterstripe-close:acct_fallback" },
    );
  });

  it("preserves pending provenance and refuses close when required provider lookup fails", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockRejectedValue(
      new Error("retrieve unavailable"),
    );
    const { ctx, runMutation } = context();
    await expect(
      closeAccount(asStripe(stripe), makeComponent(), ctx, {
        stripeAccountId: "acct_missing",
      }),
    ).rejects.toThrow("retrieve unavailable");
    expect(stripe.v2.core.accounts.close).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("does not complete local closure after provider refusal", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.close.mockRejectedValue(new Error("close boom"));
    const { ctx, runMutation } = context(["merchant"]);
    await expect(
      closeAccount(asStripe(stripe), makeComponent(), ctx, {
        stripeAccountId: "acct_err",
      }),
    ).rejects.toThrow("close boom");
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      refFor("accountClosure/mutations/prepare"),
      { stripeAccountId: "acct_err" },
    );
  });

  it("returns an already closed account without another provider operation", async () => {
    const stripe = makeStripe();
    const { ctx } = context([], "closed");
    expect(
      await closeAccount(asStripe(stripe), makeComponent(), ctx, {
        stripeAccountId: "acct_done",
      }),
    ).toEqual({ closed: true });
    expect(stripe.v2.core.accounts.close).not.toHaveBeenCalled();
    expect(stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled();
  });

  it("restartAccountOnboarding retains the same closure provenance contract", async () => {
    const stripe = makeStripe();
    const { ctx, runMutation } = context([]);
    expect(
      await restartAccountOnboarding(asStripe(stripe), makeComponent(), ctx, {
        stripeAccountId: "acct_restart",
      }),
    ).toEqual({ closed: true });
    expect(runMutation.mock.calls.map((call) => call[0])).toEqual([
      refFor("accountClosure/mutations/prepare"),
      refFor("accountClosure/mutations/complete"),
    ]);
  });
});
