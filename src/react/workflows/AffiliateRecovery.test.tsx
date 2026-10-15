// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  AffiliateRecovery,
  AffiliateRecoveryHistory,
} from "./AffiliateRecovery.js";
import { affiliateRecoveryScenarios } from "../../testing/affiliate-recovery.js";
import type { AffiliateRecoveryOperation } from "../../client/affiliateRecovery.js";
afterEach(cleanup);
it("shows exact recovered, debt and withheld amounts and labels simulated data separately", () => {
  const fixture = affiliateRecoveryScenarios().find(
    (r) => r.id === "paid-out",
  )!;
  expect(fixture.evidence).toBe("simulated");
  render(<AffiliateRecovery snapshot={fixture.snapshot} currency="usd" />);
  expect(screen.getAllByText("$10.01").length).toBeGreaterThan(1);
  expect(screen.getByText("insufficient_balance")).toBeDefined();
  expect(screen.getByText("Outstanding debt")).toBeDefined();
  expect(screen.getByText("Withheld earnings")).toBeDefined();
});
it("exposes identical formatted metrics through the headless render API", () => {
  const fixture = affiliateRecoveryScenarios().find((r) => r.id === "overlap")!;
  let metrics: { key: string; formattedValue: string }[] = [];
  render(
    <AffiliateRecovery snapshot={fixture.snapshot} currency="usd">
      {(state) => {
        metrics = state.metrics;
        return <p>{state.rows[0].sourceChargeId}</p>;
      }}
    </AffiliateRecovery>,
  );
  expect(metrics.find((r) => r.key === "recoveredAmount")!.formattedValue).toBe(
    "$10.01",
  );
  expect(metrics.find((r) => r.key === "restoredAmount")!.formattedValue).toBe(
    "$5.00",
  );
  expect(metrics.find((r) => r.key === "outstandingDebt")!.formattedValue).toBe(
    "$0.00",
  );
});
it("provides an operator reconcile action and visible provider errors without claiming success", async () => {
  const fixture = affiliateRecoveryScenarios().find((r) => r.id === "unknown")!;
  const retry = vi
    .fn()
    .mockRejectedValue(new Error("Provider outcome is unknown"));
  render(
    <AffiliateRecovery
      snapshot={fixture.snapshot}
      currency="usd"
      onRetry={retry}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reconcile" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Provider outcome is unknown",
    ),
  );
  expect(retry).toHaveBeenCalledWith(fixture.snapshot.obligations.page[0]._id);
});
it("shows authentication, pagination and unconfirmed receipt states", () => {
  const { rerender } = render(
    <AffiliateRecovery snapshot={null} currency="usd" />,
  );
  expect(
    screen.getByText("Sign in to view your commission recovery."),
  ).toBeDefined();
  const fixture = affiliateRecoveryScenarios()[0];
  rerender(
    <AffiliateRecovery
      snapshot={{
        ...fixture.snapshot,
        obligations: { ...fixture.snapshot.obligations, isDone: false },
      }}
      currency="usd"
    />,
  );
  expect(screen.getByText(/More adjustments are available/)).toBeDefined();
  rerender(
    <AffiliateRecoveryHistory
      currency="usd"
      operations={[
        {
          _id: "fixture_op",
          kind: "restoration",
          amount: 501,
          state: "unknown",
          attempted: true,
          createdAt: 0,
          _creationTime: 0,
          obligationId: "fixture_debt",
        } as AffiliateRecoveryOperation,
      ]}
    />,
  );
  expect(screen.getByText("Unconfirmed")).toBeDefined();
  expect(screen.getByText("unknown")).toBeDefined();
});
