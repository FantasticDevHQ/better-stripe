import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "admin",
  actor: "actor-a",
  execute: vi.fn(async () => "run-id"),
}));
vi.mock("convex/react", async (original) => ({
  ...(await original<typeof import("convex/react")>()),
  useQuery: () => null,
  useAction: () => state.execute,
}));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({
    currentUser: { id: state.actor, name: "Demo", role: state.role },
    currentRole: state.role,
  }),
}));
import * as page from "./metered-usage-demo";
afterEach(() => {
  cleanup();
  state.role = "admin";
  state.actor = "actor-a";
  state.execute.mockClear();
});
it("offers three named native flows and model-specific reusable configuration controls", async () => {
  const Demo = page.MeteredProtocolDemo ?? (() => null);
  render(<Demo />);
  expect(screen.getByRole("button", { name: "Pay as you go" })).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Included monthly usage" }),
  );
  expect(
    screen.getByLabelText("Included units per billing period"),
  ).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Prepaid credits" }),
  );
  expect(screen.getByLabelText("Credit package quantity")).toBeTruthy();
  expect(screen.getByText(/Manual top-up/)).toBeTruthy();
  expect(screen.queryByText(/Paid invoice/)).toBeNull();
});
it("does not offer an operator workflow to an unauthenticated demo visitor", () => {
  state.role = "visitor";
  state.actor = "";
  const Demo = page.MeteredProtocolDemo ?? (() => null);
  render(<Demo />);
  expect(
    screen.getByText(/Choose a customer, seller or admin persona/),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Set up/i })).toBeNull();
});
it("keeps configuration read-only for customer personas while offering the server-owned defaults", () => {
  state.role = "customer";
  const Demo = page.MeteredProtocolDemo ?? (() => null);
  render(<Demo />);
  expect(screen.getByRole("button", { name: "Set up sandbox" })).toBeTruthy();
  expect(screen.getByLabelText("Billable unit").matches(":disabled")).toBe(
    true,
  );
  expect(
    screen.getByText(/Demo personas are not production authentication/),
  ).toBeTruthy();
});
