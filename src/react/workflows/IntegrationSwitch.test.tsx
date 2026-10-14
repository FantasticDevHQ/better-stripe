// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { IntegrationSwitch } from "./IntegrationSwitch.js";
afterEach(cleanup);
it("mounts only the selected integration and falls back when a requested mode is unsupported", async () => {
  const mount = vi.fn();
  function Embedded() {
    mount();
    return <p>Stripe component</p>;
  }
  render(
    <IntegrationSwitch
      value="hosted"
      views={{ headless: <p>API controls</p>, embedded: <Embedded /> }}
    />,
  );
  expect(screen.getByText("API controls")).toBeTruthy();
  expect(mount).not.toHaveBeenCalled();
});
it("allows an uncontrolled choice without requiring a router", async () => {
  render(
    <IntegrationSwitch
      views={{
        headless: <p>API controls</p>,
        embedded: <p>Stripe component</p>,
      }}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Stripe embedded" }),
  );
  expect(screen.getByText("Stripe component")).toBeTruthy();
  expect(screen.queryByText("API controls")).toBeNull();
});
it("names API, BetterStripe components, and Stripe UI distinctly while preserving mode values", async () => {
  const changed = vi.fn();
  render(
    <IntegrationSwitch
      views={{
        headless: <p>API controls</p>,
        components: <p>Package UI</p>,
        embedded: <p>Stripe embed</p>,
        hosted: <p>Stripe portal</p>,
      }}
      onValueChange={changed}
    />,
  );
  expect(screen.getByRole("button", { name: "via API" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stripe embedded" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stripe hosted" })).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "BetterStripe components" }),
  );
  expect(changed).toHaveBeenLastCalledWith("components");
  expect(screen.getByText("Package UI")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "via API" }));
  expect(changed).toHaveBeenLastCalledWith("headless");
  expect(screen.queryByRole("button", { name: "Headless" })).toBeNull();
});
