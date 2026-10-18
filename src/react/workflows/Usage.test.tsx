// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as ui from "../index.js";
import { creditBalance, usageScope, usageSnapshot } from "./Usage.fixtures.js";
import type { UsageBillingSnapshot, UsageViewScope } from "./Usage.types.js";
afterEach(cleanup);
it("renders exact local quantities and keeps unknown delivery separate from native aggregation and final billing", () => {
  expect(ui.UsageSummary).toBeTypeOf("function");
  const snapshot = usageSnapshot("900719925474.099301");
  render(<ui.UsageSummary scope={usageScope} {...snapshot} />);
  expect(
    screen.getAllByText("900719925474.099301 call").length,
  ).toBeGreaterThan(0);
  expect(screen.getByText(/Native aggregation unavailable/)).toBeTruthy();
  expect(screen.getByText(/Unknown delivery/)).toBeTruthy();
  expect(screen.getByText(/Estimate only/)).toBeTruthy();
  expect(screen.queryByText(/Paid invoice/)).toBeNull();
});
it("does not turn loading or unavailable usage into an empty or zero bill", () => {
  expect(ui.UsageSummary).toBeTypeOf("function");
  const { rerender } = render(
    <ui.UsageSummary scope={usageScope} summary={undefined} />,
  );
  expect(screen.getByText("Loading usage…")).toBeTruthy();
  rerender(
    <ui.UsageSummary
      scope={usageScope}
      summary={{
        status: "unsupported",
        reason: "unsupported_scope",
        retryable: false,
      }}
    />,
  );
  expect(screen.getByText(/Usage unsupported/)).toBeTruthy();
  expect(screen.queryByText(/No usage/)).toBeNull();
  expect(screen.queryByText(/0\.00/)).toBeNull();
});
it("labels incomplete local and stale partial native data without summing or finalizing it", () => {
  expect(ui.UsageSummary).toBeTypeOf("function");
  const snapshot = usageSnapshot();
  if (snapshot.summary.status === "available")
    snapshot.summary.value.complete = false;
  render(
    <ui.UsageSummary
      scope={usageScope}
      {...snapshot}
      provider={{
        status: "available",
        observedAt: 650,
        value: {
          period: usageScope.period,
          quantity: "3",
          scaledQuantity: "3000000",
          complete: false,
          nextCursor: "next",
          aggregationLagPossible: true,
          stale: true,
          entries: [],
        },
      }}
    />,
  );
  expect(screen.getByText(/Local history incomplete/)).toBeTruthy();
  expect(screen.getByText(/Native aggregation stale/)).toBeTruthy();
  expect(screen.getByText(/Native aggregation partial/)).toBeTruthy();
  expect(screen.getByText(/Aggregation may be delayed/)).toBeTruthy();
});
it("shows pending purchases, exhausted credit and held invoice applications as separate observations", () => {
  expect(ui.UsageCredits).toBeTypeOf("function");
  render(
    <ui.UsageCredits
      balance={{ status: "available", observedAt: 700, value: creditBalance }}
      purchase={{
        purchaseId: "topup1",
        state: "pending",
        paymentIntentId: "pi_one",
        creditGrantId: null,
        quantity: "10",
        amount: 20,
        currency: "usd",
      }}
      application={{
        status: "unavailable",
        reason: "invoice_provenance_unavailable",
        retryable: true,
      }}
    />,
  );
  expect(screen.getByText(/Payment pending/)).toBeTruthy();
  expect(screen.getByText(/Insufficient credits/)).toBeTruthy();
  expect(screen.getByText(/Credit application unavailable/)).toBeTruthy();
  expect(
    screen.getByText(/No cash is collected by consuming credits/),
  ).toBeTruthy();
});
it("provides exact decimal currency formatting without floating-point rounding", () => {
  expect(ui.formatUsageEstimate).toBeTypeOf("function");
  expect(ui.formatUsageEstimate("9007199254740993.123", "usd")).toBe(
    "90071992547409.93123 USD",
  );
  expect(ui.formatUsageEstimate("25", "jpy")).toBe("25 JPY");
  expect(ui.formatUsageEstimate("1.5", "isk")).toBeNull();
  expect(ui.formatUsageEstimate("NaN", "usd")).toBeNull();
});
for (const change of [
  "identityKey",
  "accountKey",
  "meterKey",
  "period",
  "currency",
] as const)
  it(`ignores old asynchronous usage after ${change} changes and shares its state with render props`, async () => {
    expect(ui.UsageBilling).toBeTypeOf("function");
    let finish!: (snapshot: UsageBillingSnapshot) => void;
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<UsageBillingSnapshot>((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementationOnce(async (scope: UsageViewScope) => {
        const next = usageSnapshot("7");
        if (next.summary.status === "available") {
          next.summary.value.period = scope.period;
          next.summary.value.groups[0].binding.plan.rate.currency =
            scope.currency;
          const estimate = next.summary.value.groups[0].estimate;
          if (estimate.status === "available")
            estimate.value.currency = scope.currency;
        }
        return next;
      });
    const { rerender } = render(
      <ui.UsageBilling scope={usageScope} load={load} />,
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const scope: UsageViewScope = {
      ...usageScope,
      [change]:
        change === "period"
          ? { start: 1200, end: 1800 }
          : change === "currency"
            ? "jpy"
            : "other",
    };
    rerender(
      <ui.UsageBilling scope={scope} load={load}>
        {(state) => (
          <p>
            {state.data?.summary.status === "available"
              ? state.data.summary.value.groups[0].acceptedQuantity
              : "waiting"}
          </p>
        )}
      </ui.UsageBilling>,
    );
    await screen.findByText("7");
    await act(async () => finish(usageSnapshot("99")));
    expect(screen.queryByText("99")).toBeNull();
    expect(load).toHaveBeenLastCalledWith(scope);
  });
it("sanitizes loader failures and provides an explicit keyboard-accessible retry", async () => {
  expect(ui.UsageBilling).toBeTypeOf("function");
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("sk_test_private failure"))
    .mockResolvedValueOnce(usageSnapshot());
  render(<ui.UsageBilling scope={usageScope} load={load} />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Usage unavailable. Try again.",
  );
  expect(screen.queryByText(/sk_test_private/)).toBeNull();
  expect(screen.queryByText("Loading usage…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
  await screen.findByText("Usage by meter");
  expect(load).toHaveBeenCalledTimes(2);
});

it("exposes exact allowance progress, soft warnings and hard enforcement as server observations", () => {
  expect(ui.UsageAllowance).toBeTypeOf("function");
  render(
    <ui.UsageAllowance
      unit="call"
      allowance={{
        status: "available",
        observedAt: 700,
        value: {
          revision: 2,
          observedAt: 700,
          period: usageScope.period,
          accepting: true,
          policy: {
            reset: "billing_period",
            rollover: "none",
            entitled: true,
            overage: "allow",
            limit: { mode: "soft", quantity: "10" },
          },
          consumedQuantity: "12",
          reservedQuantity: "2",
          includedQuantity: "10",
          remainingIncludedQuantity: "0",
          billableOverageQuantity: "2",
          softLimitReached: true,
          hardLimitRemainingQuantity: null,
          committedEstimate: { amountDecimal: "4", currency: "usd" },
          projectedEstimate: { amountDecimal: "8", currency: "usd" },
          cashCollection: "none",
        },
      }}
    />,
  );
  expect(screen.getByText(/Soft threshold reached/)).toBeTruthy();
  expect(screen.getByText(/Display only/)).toBeTruthy();
  expect(
    screen.getByRole("progressbar").getAttribute("aria-valuetext"),
  ).toMatch(/12 consumed and 2 reserved of 10 call/);
  expect(screen.getByText("0.04 USD", { exact: false })).toBeTruthy();
  expect(
    screen.getByText(/Resets at the verified billing-period boundary/),
  ).toBeTruthy();
});
it("holds a response with another period or currency instead of rendering it under the selected scope", async () => {
  expect(ui.UsageBilling).toBeTypeOf("function");
  render(
    <ui.UsageBilling
      scope={{ ...usageScope, currency: "jpy" }}
      load={async () => usageSnapshot("99")}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Usage unavailable. Try again.",
  );
  expect(screen.queryByText("99 call")).toBeNull();
});

for (const model of ["pay_as_you_go", "included_overage", "prepaid"] as const)
  it(`renders the package's original ${model} summary without converting estimates into paid cash`, () => {
    const data = usageSnapshot("14", model);
    render(<ui.UsageSummary scope={usageScope} {...data} />);
    expect(screen.getByText(/Estimate only/)).toBeTruthy();
    if (model === "included_overage") {
      expect(screen.getByText("Overage units")).toBeTruthy();
      expect(screen.getByText(/Estimated usage charge: 0.08 USD/)).toBeTruthy();
    } else if (model === "pay_as_you_go")
      expect(screen.getByText(/Estimated usage charge: 0.28 USD/)).toBeTruthy();
    else expect(screen.getByText(/Prepaid credits/)).toBeTruthy();
  });

it("keeps raw host failure reasons out of the default billing displays", () => {
  const unavailable = {
    status: "unavailable" as const,
    reason: "sk_test_private_raw_failure",
    retryable: true,
  };
  render(
    <>
      <ui.UsageSummary
        scope={usageScope}
        summary={unavailable}
        provider={unavailable}
      />
      <ui.UsageAllowance unit="call" allowance={unavailable} />
      <ui.UsageCredits balance={unavailable} application={unavailable} />
    </>,
  );
  expect(screen.queryByText(/sk_test_private_raw_failure/)).toBeNull();
  expect(screen.getByText(/Usage unavailable/)).toBeTruthy();
});

it("does not display a previous period's native aggregate in a directly supplied summary view", () => {
  const snapshot = usageSnapshot();
  render(
    <ui.UsageSummary
      scope={{ ...usageScope, period: { start: 1200, end: 1800 } }}
      summary={snapshot.summary}
      provider={{
        status: "available",
        observedAt: 700,
        value: {
          period: usageScope.period,
          quantity: "99",
          scaledQuantity: "99000000",
          complete: true,
          nextCursor: null,
          aggregationLagPossible: true,
          stale: false,
          entries: [],
        },
      }}
    />,
  );
  expect(screen.queryByText("Native aggregate: 99")).toBeNull();
});

it("keeps a valid numeric period outside JavaScript's Date range from crashing the usage view", () => {
  const period = {
    start: Number.MAX_SAFE_INTEGER - 1,
    end: Number.MAX_SAFE_INTEGER,
  };
  const data = usageSnapshot();
  if (data.summary.status === "available") data.summary.value.period = period;
  expect(() =>
    render(<ui.UsageSummary scope={{ ...usageScope, period }} {...data} />),
  ).not.toThrow();
  expect(screen.getByText(/Time unavailable/)).toBeTruthy();
});

for (const mode of ["direct", "async"])
  it(`rejects an estimate in another currency through the ${mode} view`, async () => {
    const data = usageSnapshot();
    if (data.summary.status === "available")
      data.summary.value.groups[0].estimate = {
        status: "available",
        observedAt: 700,
        value: { amountDecimal: "28", currency: "eur" },
      };
    if (mode === "direct") {
      render(<ui.UsageSummary scope={usageScope} {...data} />);
      expect(screen.getByText(/Usage unavailable/)).toBeTruthy();
    } else {
      render(<ui.UsageBilling scope={usageScope} load={async () => data} />);
      await screen.findByRole("alert");
    }
    expect(screen.queryByText(/0.28 EUR/)).toBeNull();
  });
for (const model of ["pay_as_you_go", "included_overage", "prepaid"] as const)
  it(`shares the ${model} summary layout between component observations and serialized API adapters`, async () => {
    const data = usageSnapshot("14", model);
    const direct = render(<ui.UsageSummary scope={usageScope} {...data} />);
    const expected = direct.container.querySelector(
      '[data-better-stripe="usage-summary"]',
    )!.innerHTML;
    cleanup();
    for (const load of [
      async () => data,
      async () => JSON.parse(JSON.stringify(data)),
    ]) {
      const view = render(<ui.UsageBilling scope={usageScope} load={load} />);
      await waitFor(() =>
        expect(
          view.container.querySelector('[data-better-stripe="usage-summary"]')!
            .innerHTML,
        ).toBe(expected),
      );
      cleanup();
    }
  });

it("labels a complete empty local period without inferring zero from partial history", () => {
  const data = usageSnapshot();
  if (data.summary.status === "available") {
    data.summary.value.groups = [];
    data.summary.value.eventCount = 0;
    data.summary.value.complete = false;
  }
  const { rerender } = render(<ui.UsageSummary scope={usageScope} {...data} />);
  expect(screen.queryByText("No usage in this period.")).toBeNull();
  if (data.summary.status === "available") data.summary.value.complete = true;
  rerender(<ui.UsageSummary scope={usageScope} {...data} />);
  expect(screen.getByText("No usage in this period.")).toBeTruthy();
});
