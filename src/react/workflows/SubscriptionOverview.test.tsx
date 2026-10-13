// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SubscriptionOverview } from "./SubscriptionOverview.js";
afterEach(cleanup);
it("renders loading, empty, and current subscription states without app providers", () => {
  const { rerender } = render(
    <SubscriptionOverview subscriptions={undefined} />,
  );
  expect(screen.getByRole("status").textContent).toContain("Loading");
  rerender(<SubscriptionOverview subscriptions={[]} />);
  expect(screen.getByText("No subscription yet.")).toBeTruthy();
  rerender(
    <SubscriptionOverview
      subscriptions={[
        {
          stripeSubscriptionId: "sub_old",
          status: "canceled",
          cancelAtPeriodEnd: true,
        },
        { stripeSubscriptionId: "sub_new", status: "active" },
      ]}
    />,
  );
  expect(screen.getByText("sub_new")).toBeTruthy();
  expect(screen.queryByText("sub_old")).toBeNull();
});
