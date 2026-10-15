import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
const actions = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useAction: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref).split(":")[1] as keyof typeof actions;
    return actions[name];
  },
}));
import { PayoutPolicyPanel } from "./payout-policy-panel";
const view = {
  policy: {
    mode: "custom",
    status: "ready",
    revision: 0,
    country: "US",
    thresholds: [{ currency: "usd", amount: 1000 }],
    holdDeadline: 1900000000000,
  },
  nextAttemptAt: 1800000300000,
  preview: {
    status: "held",
    reason: "below_threshold",
    currency: "usd",
    amount: 0,
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
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  actions.load.mockResolvedValue(view);
  actions.save.mockResolvedValue({ status: "ready" });
});
it("uses package progress and settings with the example's cards and server-derived scope", async () => {
  const { container } = render(
    <PayoutPolicyPanel userId={"seller" as Id<"users">} currencies={["usd"]} />,
  );
  expect(await screen.findByText("$9.99")).toBeVisible();
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "999",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuemax",
    "1000",
  );
  expect(
    container.querySelectorAll('[data-slot="card"]').length,
  ).toBeGreaterThanOrEqual(6);
  expect(screen.getByText(/Below-minimum funds remain owed/)).toBeVisible();
  expect(screen.getByText(/not a bank arrival date/)).toBeVisible();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Save payout settings" }),
  );
  await waitFor(() =>
    expect(actions.save).toHaveBeenCalledWith({
      userId: "seller",
      currency: "usd",
      expectedRevision: 0,
      mode: "custom",
      minimum: 1000,
      consent: true,
    }),
  );
  expect(actions.load).toHaveBeenCalledWith({
    userId: "seller",
    currency: "usd",
  });
});
it("shows an actionable read error and refreshes without enabling settings from missing data", async () => {
  actions.load.mockRejectedValueOnce(new Error("Unavailable assessment"));
  render(
    <PayoutPolicyPanel
      userId={"affiliate" as Id<"users">}
      currencies={["usd"]}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unavailable assessment",
  );
  expect(
    screen.getByRole("button", { name: "Save payout settings" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh payout policy" }),
  );
  expect(await screen.findByText("$9.99")).toBeVisible();
});
it("invalidates an old assessment if refreshing it fails", async () => {
  render(
    <PayoutPolicyPanel userId={"seller" as Id<"users">} currencies={["usd"]} />,
  );
  await screen.findByText("$9.99");
  await userEvent.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", { name: "Save payout settings" }),
  ).toBeEnabled();
  actions.load.mockRejectedValueOnce(new Error("Refresh failed"));
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh payout policy" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Refresh failed");
  expect(
    screen.getByRole("button", { name: "Save payout settings" }),
  ).toBeDisabled();
  expect(screen.queryByRole("progressbar")).toBeNull();
});
it("renders package accounting cards and source payout columns from the assessment", async () => {
  actions.load.mockResolvedValue({
    ...view,
    preview: {
      ...view.preview,
      matureUnpaid: 899,
      independentLiabilities: 100,
      accounting: {
        carriedForwardAmount: 899,
        withheldAmount: 100,
        releasedAmount: 1000,
        reservedAmount: 200,
      },
      sources: view.preview.sources.map((source) => ({
        ...source,
        releasedAmount:
          source.role === "store" ? 600 : source.role === "affiliate" ? 400 : 0,
        reservedAmount: source.role === "other" ? 0 : 100,
      })),
    },
  });
  render(
    <PayoutPolicyPanel userId={"seller" as Id<"users">} currencies={["usd"]} />,
  );
  expect(await screen.findByText("Carried forward")).toBeVisible();
  expect(screen.getByText("Paid out, net of returns")).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Paid out" })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "In flight" })).toBeVisible();
});
