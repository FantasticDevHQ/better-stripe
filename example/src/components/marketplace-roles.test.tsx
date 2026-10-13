import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { NavSidebar } from "./nav-sidebar";
import { RoleSwitcher } from "./role-switcher";

const state = vi.hoisted(() => ({
  currentRole: "customer",
  currentUser: { id: "customer", name: "Customer" },
  setRole: vi.fn(),
  sellers: [{ id: "seller", name: "Test Store" }],
  setSeller: vi.fn(),
}));
vi.mock("@/providers/role-context", () => ({ useRole: () => state }));
function renderRole(role: string) {
  state.currentRole = role;
  render(
    <MemoryRouter>
      <RoleSwitcher />
      <NavSidebar />
    </MemoryRouter>,
  );
  return within(screen.getByRole("navigation", { name: "Primary navigation" }));
}
describe("marketplace role navigation", () => {
  it("keeps seller and affiliate finances out of the customer menu", () => {
    const nav = renderRole("customer");
    expect(
      nav.queryByRole("link", { name: "Earnings" }),
    ).not.toBeInTheDocument();
    expect(
      nav.queryByRole("link", { name: "Store Subscription" }),
    ).not.toBeInTheDocument();
    expect(
      nav.queryByRole("link", { name: "Affiliate Split" }),
    ).not.toBeInTheDocument();
    expect(
      nav.getByRole("link", { name: "Subscriptions" }),
    ).toBeInTheDocument();
    expect(
      nav.queryByRole("link", { name: "Dashboard" }),
    ).not.toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Stores" })).toBeInTheDocument();
  });
  it("gives visitors shopping without personal billing menus", () => {
    const nav = renderRole("visitor");
    expect(nav.getByRole("link", { name: "Stores" })).toBeInTheDocument();
    expect(
      nav.queryByRole("link", { name: "Billing" }),
    ).not.toBeInTheDocument();
    expect(
      nav.queryByRole("link", { name: "Dashboard" }),
    ).not.toBeInTheDocument();
  });
  it("exposes a separate affiliate role and its own earnings", () => {
    const nav = renderRole("affiliate");
    expect(
      screen.getByRole("button", { name: /^Affiliate$/ }),
    ).toBeInTheDocument();
    expect(
      nav.getByRole("link", { name: "Referral earnings" }),
    ).toHaveAttribute("href", "/affiliate");
    expect(nav.getByRole("link", { name: "Referred sales" })).toHaveAttribute(
      "href",
      "/affiliate/sales",
    );
    expect(nav.getByRole("link", { name: "Referral links" })).toHaveAttribute(
      "href",
      "/affiliate/links",
    );
    expect(
      nav.queryByRole("link", { name: "Billing" }),
    ).not.toBeInTheDocument();
  });
  for (const role of ["seller", "affiliate", "admin"]) {
    it(`hides Stores from the ${role} menu`, () => {
      const nav = renderRole(role);
      expect(
        nav.queryByRole("link", { name: "Stores" }),
      ).not.toBeInTheDocument();
    });
  }
  it("puts store subscriptions and earnings with the seller", () => {
    const nav = renderRole("seller");
    expect(
      nav.getByRole("link", { name: "Subscriptions" }),
    ).toBeInTheDocument();
    expect(nav.getAllByRole("link")[1]).toHaveTextContent("Earnings");
    const sellerLinks = nav.getAllByRole("link");
    expect(
      sellerLinks[
        sellerLinks.findIndex((link) => link.textContent === "Account") + 1
      ],
    ).toHaveTextContent("Billing");
    expect(nav.getByRole("link", { name: "Billing" })).toHaveAttribute(
      "href",
      "/seller/plan",
    );
  });
});

it("keeps the referral URL when switching from affiliate preview to a visitor", async () => {
  state.currentRole = "affiliate";
  const { fireEvent } = await import("@testing-library/react");
  const { useLocation } = await import("react-router-dom");
  function Location() {
    const location = useLocation();
    return (
      <output>
        {location.pathname}
        {location.search}
      </output>
    );
  }
  render(
    <MemoryRouter initialEntries={["/stores?ref=avery&store=acct_seller"]}>
      <RoleSwitcher />
      <Location />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Visitor" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "/stores?ref=avery&store=acct_seller",
  );
});
