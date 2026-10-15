// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { PayoutPreview } from "../../client/payoutPolicy.js";
import { PayoutProgress } from "./PayoutProgress.js";
afterEach(cleanup);
const policy = {
  mode: "custom" as const,
  status: "ready" as const,
  thresholds: [{ currency: "usd", amount: 1000 }],
  holdDeadline: 1900000000000,
};
const preview: PayoutPreview = {
  status: "held",
  reason: "below_threshold",
  amount: 0,
  currency: "usd",
  threshold: 1000,
  providerMinimum: null,
  matureUnpaid: 999,
  pendingCredits: 200,
  confirmedFees: 0,
  independentLiabilities: 0,
  providerAvailable: 999,
  observedAt: 1800000000000,
  sources: [
    { role: "store", matureUnpaid: 599, pendingCredits: 200 },
    { role: "affiliate", matureUnpaid: 400, pendingCredits: 0 },
    { role: "other", matureUnpaid: 0, pendingCredits: 0 },
  ],
};
it("shows one combined minimum, pending settlement and source contributions", () => {
  render(<PayoutProgress policy={policy} preview={preview} currency="usd" />);
  expect(screen.getByRole("progressbar").getAttribute("max")).toBe("1000");
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("999");
  expect(screen.getByText("$9.99")).toBeTruthy();
  expect(screen.getByText("$5.99")).toBeTruthy();
  expect(screen.getByText("$4.00")).toBeTruthy();
  expect(screen.getByText(/Below-minimum funds remain owed/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /withdraw|pay out/i }),
  ).toBeNull();
});
it("does not invent zero balances or progress for an unavailable assessment", () => {
  render(
    <PayoutProgress
      policy={policy}
      currency="usd"
      preview={{
        status: "held",
        reason: "unallocated_history",
        amount: 0,
      }}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("reconciliation");
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText("$0.00")).toBeNull();
});
it("shows verified carry forward, withholding, in-flight and paid totals separately", () => {
  render(
    <PayoutProgress
      policy={policy}
      currency="usd"
      preview={{
        ...preview,
        matureUnpaid: 899,
        independentLiabilities: 100,
        accounting: {
          carriedForwardAmount: 899,
          withheldAmount: 100,
          reservedAmount: 200,
          releasedAmount: 1000,
        },
        sources: [
          { ...preview.sources[0], reservedAmount: 100, releasedAmount: 600 },
          { ...preview.sources[1], reservedAmount: 100, releasedAmount: 400 },
          { ...preview.sources[2], reservedAmount: 0, releasedAmount: 0 },
        ],
      }}
    />,
  );
  for (const [label, value] of [
    ["Carried forward", "$8.99"],
    ["Withheld for costs", "$1.00"],
    ["Payouts in progress", "$2.00"],
    ["Paid out, net of returns", "$10.00"],
  ])
    expect(screen.getByText(label).nextElementSibling?.textContent).toBe(value);
  expect(screen.getByRole("columnheader", { name: "Paid out" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "In flight" })).toBeTruthy();
});
it("explains an expired holding deadline without inventing a payable balance", () => {
  render(
    <PayoutProgress
      policy={policy}
      currency="usd"
      preview={{ status: "held", reason: "expired", amount: 0 }}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "holding deadline has passed",
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText("$0.00")).toBeNull();
});
it("does not invent new accounting totals for a legacy assessment", () => {
  render(<PayoutProgress policy={policy} preview={preview} currency="usd" />);
  expect(screen.queryByText("Carried forward")).toBeNull();
  expect(screen.queryByText("Paid out, net of returns")).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Paid out" })).toBeNull();
});
it("keeps Stripe-managed defaults distinct from a custom application minimum", () => {
  render(<PayoutProgress policy={null} currency="usd" />);
  expect(screen.getByRole("status").textContent).toContain("Stripe manages");
  expect(screen.getByText(/numeric amount is unavailable/)).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText("$1.00")).toBeNull();
});
it.each(["custom", "stripe_managed"] as const)(
  "keeps %s mode unverified while the schedule change is pending",
  (mode) => {
    render(
      <PayoutProgress
        policy={{ ...policy, mode, status: "changing" }}
        preview={preview}
        currency="usd"
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("being verified");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/Stripe manages automatic payouts/)).toBeNull();
    expect(screen.queryByText("Combined qualifying balance")).toBeNull();
  },
);
it("gives host cards an unverified state during activation from Stripe-managed defaults", () => {
  render(
    <PayoutProgress
      policy={{ ...policy, mode: "stripe_managed", status: "changing" }}
      preview={preview}
      currency="usd"
    >
      {(state) => (
        <span data-testid="restoration">
          {state.status}:{state.metrics.length}
        </span>
      )}
    </PayoutProgress>,
  );
  expect(screen.getByTestId("restoration").textContent).toBe("changing:0");
});
it("preserves negative entitlement while clamping only the visual progress", () => {
  render(
    <PayoutProgress
      policy={policy}
      preview={{ ...preview, matureUnpaid: -100 }}
      currency="usd"
    />,
  );
  expect(screen.getByText("-$1.00")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("0");
});
it("distinguishes the next worker attempt from a bank arrival date", () => {
  render(
    <PayoutProgress
      policy={policy}
      preview={preview}
      currency="usd"
      nextAttemptAt={1800000000000}
      timeZone="UTC"
    />,
  );
  expect(screen.getByText(/Next automatic attempt:/).textContent).toContain(
    "not a bank arrival date",
  );
  expect(screen.getByText(/Custom holding deadline:/)).toBeTruthy();
});
it("rejects another currency or changed threshold instead of displaying mixed progress", () => {
  expect(() =>
    render(<PayoutProgress policy={policy} preview={preview} currency="eur" />),
  ).toThrow("does not match");
  expect(() =>
    render(
      <PayoutProgress
        policy={{ ...policy, thresholds: [{ currency: "usd", amount: 2000 }] }}
        preview={preview}
        currency="usd"
      />,
    ),
  ).toThrow("does not match");
});
it("exposes the same financial state for translated host cards", () => {
  render(
    <PayoutProgress policy={policy} preview={preview} currency="usd">
      {(state) => (
        <article data-testid="custom">
          {state.status}{" "}
          {
            state.metrics.find((metric) => metric.key === "qualifying")
              ?.formattedValue
          }
        </article>
      )}
    </PayoutProgress>,
  );
  expect(screen.getByTestId("custom").textContent).toBe("assessed $9.99");
  expect(screen.queryByText("Source contributions")).toBeNull();
});
it.each([1000, 1100])(
  "shows a qualifying combined assessment at %i without separate category minimums",
  (total) => {
    render(
      <PayoutProgress
        policy={policy}
        currency="usd"
        preview={{
          ...preview,
          status: "qualified",
          reason: undefined,
          amount: total,
          matureUnpaid: total,
          sources: [
            { role: "store", matureUnpaid: total - 400, pendingCredits: 0 },
            { role: "affiliate", matureUnpaid: 400, pendingCredits: 0 },
          ],
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("qualif");
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("1000");
  },
);
it("does not display a former custom holding deadline for Stripe-managed payouts", () => {
  render(
    <PayoutProgress
      policy={{ ...policy, mode: "stripe_managed" }}
      currency="usd"
      preview={preview}
    />,
  );
  expect(screen.queryByText(/Custom holding deadline:/)).toBeNull();
});

it("explains the deadline waiver without a minimum progress bar", () => {
  render(
    <PayoutProgress
      policy={policy}
      currency="usd"
      preview={{
        ...preview,
        status: "qualified",
        reason: undefined,
        amount: 999,
        minimumWaived: true,
        holdDeadline: policy.holdDeadline,
      }}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("holding deadline");
  expect(screen.getByRole("status").textContent).toContain(
    "application minimum is waived",
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("Combined payout minimum")).toBeTruthy();
});

it("shows expiry recovery after automatic schedule restoration without claiming disbursement", () => {
  render(
    <PayoutProgress
      policy={{
        ...policy,
        mode: "stripe_managed",
        thresholds: [],
        holdingExpiry: {
          deadline: policy.holdDeadline,
          status: "balance_remaining",
          observedAt: 1800000000000,
          balances: [{ currency: "usd", available: 999, pending: 25 }],
        },
      }}
      currency="usd"
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "does not confirm disbursement",
  );
  expect(screen.queryByText(/Stripe manages automatic payouts/)).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("$9.99")).toBeTruthy();
  expect(screen.getByText("$0.25")).toBeTruthy();
});
it("keeps unavailable expiry balances unverified instead of showing fabricated zero", () => {
  render(
    <PayoutProgress
      policy={{
        ...policy,
        mode: "stripe_managed",
        holdingExpiry: { deadline: policy.holdDeadline, status: "unverified" },
      }}
      currency="usd"
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "verification is unavailable",
  );
  expect(screen.queryByText("$0.00")).toBeNull();
});

it("shows a previous Stripe rejection separately from informational eligibility", () => {
  render(
    <PayoutProgress
      policy={policy}
      preview={{
        ...preview,
        status: "qualified",
        reason: undefined,
        amount: 999,
        minimumWaived: true,
        holdDeadline: policy.holdDeadline,
      }}
      currency="usd"
      lastAttempt={{
        currency: "usd",
        status: "rejected",
        reason: "balance_insufficient",
        at: 1800000000000,
      }}
      nextAttemptAt={1800000300000}
      timeZone="UTC"
    />,
  );
  expect(
    screen.getByText(
      /Stripe rejected the payout because the available balance changed/,
    ),
  ).toBeTruthy();
  expect(screen.getByText(/Next automatic attempt/)).toBeTruthy();
});
it("does not display an old paid result or stale retry time while a new check is running", () => {
  render(
    <PayoutProgress
      policy={policy}
      preview={preview}
      currency="usd"
      lastAttempt={{
        currency: "usd",
        status: "running",
        reason: "pending_claim",
      }}
      nextAttemptAt={1800000000000}
    />,
  );
  expect(screen.getByText(/automatic payout check is running/)).toBeTruthy();
  expect(screen.queryByText(/Next automatic attempt/)).toBeNull();
});
