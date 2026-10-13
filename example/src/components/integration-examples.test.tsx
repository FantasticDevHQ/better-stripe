import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { IntegrationExamples } from "./integration-examples";
function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}
it("mounts only the selected implementation and preserves account and referral query parameters", async () => {
  const mounted = vi.fn();
  function Embedded() {
    mounted();
    return <p>Stripe account component</p>;
  }
  render(
    <MemoryRouter initialEntries={["/seller/account?section=setup&ref=avery"]}>
      <IntegrationExamples
        headless={<p>Custom account form</p>}
        embedded={<Embedded />}
      />
      <Location />
    </MemoryRouter>,
  );
  expect(screen.getByText("Custom account form")).toBeVisible();
  expect(mounted).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("tab", { name: "Stripe embedded" }));
  expect(screen.getByText("Stripe account component")).toBeVisible();
  expect(screen.getByTestId("location")).toHaveTextContent(
    "section=setup&ref=avery&example=embedded",
  );
});
it("supports direct links and labels hosted billing separately from embeds", () => {
  render(
    <MemoryRouter initialEntries={["/dashboard/billing?example=hosted"]}>
      <IntegrationExamples
        headless={<p>Custom billing</p>}
        hosted={<p>Hosted portal example</p>}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("Hosted portal example")).toBeVisible();
  expect(
    screen.queryByRole("tab", { name: "Stripe embedded" }),
  ).not.toBeInTheDocument();
});
