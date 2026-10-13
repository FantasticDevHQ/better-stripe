import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RoleProvider, useRole } from "@/providers/role-context";
const data = vi.hoisted(() => ({ users: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => data.users }));
beforeEach(() => localStorage.clear());
function Persona() {
  const context = useRole();
  return (
    <>
      <p>
        {context.currentRole}:{context.currentUser.id}:
        {context.currentUser.stripeAccountId}
      </p>
      <button onClick={() => context.setSeller("sasha")}>Choose Sasha</button>
    </>
  );
}
it("renders a real visitor without requiring a seeded user or assigning a Stripe account", () => {
  data.users = undefined;
  render(
    <RoleProvider>
      <Persona />
    </RoleProvider>,
  );
  expect(screen.getByText("visitor::")).toBeInTheDocument();
});
it("lets sellers select their own store account rather than reading another store", () => {
  localStorage.setItem("betterlearn-role", "seller");
  data.users = [
    {
      _id: "maya",
      name: "Maya",
      email: "maya@example.com",
      role: "seller",
      storeName: "Fitness",
      stripeAccountId: "acct_maya",
    },
    {
      _id: "sasha",
      name: "Sasha",
      email: "sasha@example.com",
      role: "seller",
      storeName: "Ceramics",
      stripeAccountId: "acct_sasha",
    },
  ];
  render(
    <RoleProvider>
      <Persona />
    </RoleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose Sasha" }));
  expect(screen.getByText("seller:sasha:acct_sasha")).toBeInTheDocument();
});
