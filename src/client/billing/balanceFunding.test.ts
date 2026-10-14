import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBalanceFundingCapability,
  prepareBalanceFunding,
  setBalanceFunding,
  type BalanceFundingPreparation,
} from "./balanceFunding.js";

const version = "2026-09-30.preview";
const scope = {
  customerAccount: "acct_store",
  stripeSubscriptionId: "sub_store",
};
const preparation: BalanceFundingPreparation = {
  ...scope,
  paymentMethodId: "pm_balance",
  previousPaymentMethodId: "pm_card",
  previousPaymentMethodTypes: ["card"],
};
const raw = {
  subscriptions: { retrieve: vi.fn(), update: vi.fn() },
  paymentMethods: { create: vi.fn(), attach: vi.fn(), retrieve: vi.fn() },
};
const stripe = raw as unknown as Stripe;
function sub(
  method: string | null = "pm_card",
  types: string[] | null = ["card"],
) {
  return {
    id: "sub_store",
    customer_account: "acct_store",
    status: "active",
    default_payment_method: method,
    payment_settings: { payment_method_types: types },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  raw.subscriptions.retrieve.mockResolvedValue(sub());
  raw.subscriptions.update.mockResolvedValue({ id: "sub_store" });
  raw.paymentMethods.create.mockResolvedValue({
    id: "pm_balance",
    type: "stripe_balance",
  });
  raw.paymentMethods.retrieve.mockImplementation(async (id: string) => ({
    id,
    type: id === "pm_balance" ? "stripe_balance" : "card",
    customer_account: id === "pm_balance" ? null : "acct_store",
  }));
  raw.paymentMethods.attach.mockResolvedValue({ id: "pm_balance" });
});
const enable = (enabled = true) =>
  setBalanceFunding(stripe, version, {
    preparation,
    enabled,
    consent: enabled ? true : undefined,
    idempotencyKey: "request-1",
  });
describe("explicit balance funding", () => {
  it("reports a required explicit preview without claiming provider eligibility", () => {
    expect(getBalanceFundingCapability("2026-09-30.endive")).toMatchObject({
      configured: false,
    });
    expect(getBalanceFundingCapability(version)).toMatchObject({
      configured: true,
      requiresConnectedAccount: true,
      eligibility: "provider_validates_on_prepare",
    });
  });
  it("rejects GA calls and missing consent before provider requests", async () => {
    await expect(
      prepareBalanceFunding(stripe, "2026-09-30.endive", {
        ...scope,
        consent: true,
        idempotencyKey: "request-1",
      }),
    ).rejects.toThrow(/preview/);
    await expect(
      setBalanceFunding(stripe, version, {
        preparation,
        enabled: true,
        idempotencyKey: "request-1",
      }),
    ).rejects.toThrow(/consent/);
    expect(raw.subscriptions.retrieve).not.toHaveBeenCalled();
  });
  it("prepares without changing the subscription and uses stable phase keys", async () => {
    expect(
      await prepareBalanceFunding(stripe, version, {
        ...scope,
        consent: true,
        idempotencyKey: "request-1",
      }),
    ).toEqual(preparation);
    expect(raw.paymentMethods.create).toHaveBeenCalledWith(
      { type: "stripe_balance" },
      { idempotencyKey: "request-1:create" },
    );
    expect(raw.paymentMethods.attach).toHaveBeenCalledWith(
      "pm_balance",
      {
        customer_account: "acct_store",
      },
      { idempotencyKey: "request-1:attach" },
    );
    expect(raw.subscriptions.update).not.toHaveBeenCalled();
  });
  it("rejects mismatched subscription ownership before preparing or applying", async () => {
    raw.subscriptions.retrieve.mockResolvedValue({
      ...sub(),
      customer_account: "acct_other",
    });
    await expect(
      prepareBalanceFunding(stripe, version, {
        ...scope,
        consent: true,
        idempotencyKey: "request-1",
      }),
    ).rejects.toThrow(/does not belong/);
    await expect(enable()).rejects.toThrow(/does not belong/);
    expect(raw.paymentMethods.create).not.toHaveBeenCalled();
    expect(raw.subscriptions.update).not.toHaveBeenCalled();
  });
  it("enables and restores the exact previous settings on opt-out", async () => {
    raw.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_balance",
      type: "stripe_balance",
      customer_account: "acct_store",
    });
    await enable();
    expect(raw.subscriptions.update).toHaveBeenLastCalledWith(
      "sub_store",
      {
        default_payment_method: "pm_balance",
        payment_settings: { payment_method_types: ["stripe_balance"] },
      },
      { idempotencyKey: "request-1:enable" },
    );
    raw.subscriptions.retrieve.mockResolvedValue(
      sub("pm_balance", ["stripe_balance"]),
    );
    await enable(false);
    expect(raw.subscriptions.update).toHaveBeenLastCalledWith(
      "sub_store",
      {
        default_payment_method: "pm_card",
        payment_settings: { payment_method_types: ["card"] },
      },
      { idempotencyKey: "request-1:disable" },
    );
  });
  it("clears the prior default and payment types when they originally inherited customer settings", async () => {
    raw.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_balance",
      type: "stripe_balance",
      customer_account: "acct_store",
    });
    raw.subscriptions.retrieve.mockResolvedValue(
      sub("pm_balance", ["stripe_balance"]),
    );
    await setBalanceFunding(stripe, version, {
      preparation: {
        ...preparation,
        previousPaymentMethodId: null,
        previousPaymentMethodTypes: null,
      },
      enabled: false,
      idempotencyKey: "request-2",
    });
    expect(raw.subscriptions.update).toHaveBeenLastCalledWith(
      "sub_store",
      {
        default_payment_method: "",
        payment_settings: { payment_method_types: "" },
      },
      { idempotencyKey: "request-2:disable" },
    );
  });
  it("recovers an applied provider update after host persistence fails without overwriting the original snapshot", async () => {
    raw.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_balance",
      type: "stripe_balance",
      customer_account: "acct_store",
    });
    raw.subscriptions.retrieve.mockResolvedValue(
      sub("pm_balance", ["stripe_balance"]),
    );
    expect(await enable()).toEqual({ enabled: true });
    expect(raw.subscriptions.update).not.toHaveBeenCalled();
    await expect(
      prepareBalanceFunding(stripe, version, {
        ...scope,
        consent: true,
        idempotencyKey: "new-prepare",
      }),
    ).rejects.toThrow(/restoration record/);
  });
  it("does not overwrite external payment-source changes with a stale preparation", async () => {
    raw.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_balance",
      type: "stripe_balance",
      customer_account: "acct_store",
    });
    raw.subscriptions.retrieve.mockResolvedValue(
      sub("pm_external", ["card", "link"]),
    );
    await expect(enable()).rejects.toThrow(/changed/);
    await expect(enable(false)).rejects.toThrow(/changed/);
    expect(raw.subscriptions.update).not.toHaveBeenCalled();
  });
  it("rejects an unrelated balance payment method", async () => {
    raw.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_balance",
      type: "stripe_balance",
      customer_account: "acct_other",
    });
    await expect(enable()).rejects.toThrow(/payment method/);
  });
  it("preserves provider preview and update errors for retry decisions", async () => {
    const failure = Object.assign(new Error("Preview access required"), {
      code: "parameter_invalid",
    });
    raw.paymentMethods.create.mockRejectedValue(failure);
    await expect(
      prepareBalanceFunding(stripe, version, {
        ...scope,
        consent: true,
        idempotencyKey: "request-1",
      }),
    ).rejects.toBe(failure);
    raw.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_balance",
      type: "stripe_balance",
      customer_account: "acct_store",
    });
    raw.subscriptions.update.mockRejectedValue(failure);
    await expect(enable()).rejects.toBe(failure);
  });
});
