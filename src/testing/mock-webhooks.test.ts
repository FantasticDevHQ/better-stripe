import { describe, expect, it } from "vitest";

import {
  mockAccountUpdated,
  mockCheckoutCompleted,
  mockInvoicePaid,
  mockSubscriptionUpdated,
} from "./mock-webhooks.js";

describe("mockCheckoutCompleted", () => {
  it("returns correct event type", () => {
    const event = mockCheckoutCompleted();
    expect(event.type).toBe("checkout.session.completed");
  });

  it("has unique event IDs", () => {
    const a = mockCheckoutCompleted();
    const b = mockCheckoutCompleted();
    expect(a.id).not.toBe(b.id);
  });

  it("defaults to livemode false", () => {
    expect(mockCheckoutCompleted().livemode).toBe(false);
  });

  it("includes data.object with default fields", () => {
    const event = mockCheckoutCompleted();
    expect(event.data.object).toHaveProperty("id");
    expect(event.data.object).toHaveProperty("mode", "subscription");
    expect(event.data.object).toHaveProperty("status", "complete");
  });

  it("allows overrides", () => {
    const event = mockCheckoutCompleted({ mode: "payment", status: "open" });
    expect(event.data.object.mode).toBe("payment");
    expect(event.data.object.status).toBe("open");
  });
});

describe("mockSubscriptionUpdated", () => {
  it("returns correct event type", () => {
    expect(mockSubscriptionUpdated().type).toBe(
      "customer.subscription.updated",
    );
  });

  it("includes subscription data", () => {
    const event = mockSubscriptionUpdated();
    expect(event.data.object).toHaveProperty("status", "active");
    expect(event.data.object).toHaveProperty("cancel_at_period_end", false);
  });

  it("allows status override", () => {
    const event = mockSubscriptionUpdated({ status: "past_due" });
    expect(event.data.object.status).toBe("past_due");
  });
});

describe("mockAccountUpdated", () => {
  it("returns correct event type", () => {
    expect(mockAccountUpdated().type).toBe("account.updated");
  });

  it("includes account data", () => {
    const event = mockAccountUpdated();
    expect(event.data.object).toHaveProperty("charges_enabled", true);
    expect(event.data.object).toHaveProperty("payouts_enabled", true);
  });

  it("allows overrides", () => {
    const event = mockAccountUpdated({ charges_enabled: false });
    expect(event.data.object.charges_enabled).toBe(false);
  });
});

describe("mockInvoicePaid", () => {
  it("returns correct event type", () => {
    expect(mockInvoicePaid().type).toBe("invoice.paid");
  });

  it("includes invoice amounts", () => {
    const event = mockInvoicePaid();
    expect(event.data.object).toHaveProperty("amount_due", 2000);
    expect(event.data.object).toHaveProperty("amount_paid", 2000);
    expect(event.data.object).toHaveProperty("currency", "usd");
  });

  it("allows amount overrides", () => {
    const event = mockInvoicePaid({
      amount_due: 5000,
      amount_paid: 5000,
      currency: "eur",
    });
    expect(event.data.object.amount_due).toBe(5000);
    expect(event.data.object.currency).toBe("eur");
  });
});
