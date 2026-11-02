import { act, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { createExampleRouter } from "../router";
import {
  parseSearch,
  stringifySearch,
  validateSearch,
} from "../lib/router-search";

vi.mock("@/components/app-providers", () => ({ ThemeToggle: () => null }));
beforeEach(() => {
  window.scrollTo = vi.fn();
  window.matchMedia = vi
    .fn()
    .mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
});

const persona = vi.hoisted(() => ({ role: "visitor" }));
vi.mock("@/providers/role-context", () => ({
  RoleProvider: ({ children }: { children: React.ReactNode }) => children,
  useRole: () => ({
    currentRole: persona.role,
    currentUser: { id: "test", name: "Test" },
    sellers: [],
    setRole: vi.fn(),
  }),
}));
vi.mock("../pages/landing", () => ({ Landing: () => <h1>Storefront</h1> }));
vi.mock("../pages/seller/account", () => ({
  SellerAccount: () => <h1>Seller account</h1>,
}));
vi.mock("../pages/admin/index", () => ({
  AdminOverview: () => <h1>Admin overview</h1>,
}));
vi.mock("../pages/admin/setup", () => ({
  AdminSetup: () => <h1>Admin setup</h1>,
}));

const paths = [
  "/",
  "/stores",
  "/affiliate",
  "/affiliate/sales",
  "/affiliate/links",
  "/affiliate/payouts",
  "/checkout",
  "/checkout/status",
  "/demo/subscribe",
  "/demo/store-earnings",
  "/demo/affiliate-recovery",
  "/demo/metered-usage",
  "/demo/allocation",
  "/marketplace/split",
  "/demo/destination-charge",
  "/dashboard",
  "/dashboard/billing",
  "/dashboard/invoices",
  "/dashboard/payment-methods",
  "/seller",
  "/seller/sales",
  "/seller/plan",
  "/seller/onboarding",
  "/seller/payouts",
  "/seller/disputes",
  "/seller/refunds",
  "/seller/products",
  "/seller/account",
  "/seller/marketplace-account",
  "/admin",
  "/admin/store-plans",
  "/admin/products",
  "/admin/subscriptions",
  "/admin/webhooks",
  "/admin/affiliate-recovery",
  "/admin/testing",
  "/admin/setup",
] as const;
it.each(paths)("matches direct URL %s exactly", async (path) => {
  const router = createExampleRouter(
    createMemoryHistory({ initialEntries: [path] }),
  );
  await router.load();
  expect(router.state.matches.at(-1)?.fullPath).toBe(path);
  expect(router.state.matches.at(-1)?.status).toBe("success");
});

it("validates selectors and treats provider IDs as strings, never JSON or authority", () => {
  expect(
    validateSearch({
      example: "bogus",
      checkout: "bogus",
      section: "bogus",
      diagnostics: "bogus",
      session_id: { forged: true },
      ref: "00123",
    }),
  ).toMatchObject({
    example: undefined,
    checkout: undefined,
    section: undefined,
    diagnostics: undefined,
    session_id: undefined,
    ref: "00123",
  });
  const query =
    "?priceId=00123&ref=a%2Bb&session_id=%7BCHECKOUT_SESSION_ID%7D&payment_intent=pi_test&payment_intent_client_secret=synthetic&redirect_status=succeeded&charge_id=ch_test&purchase_session_id=cs_plan&offer=offer_test&extra=one&extra=two";
  expect(stringifySearch(parseSearch(query))).toBe(query);
  expect(validateSearch(parseSearch(query))).toMatchObject({
    priceId: "00123",
    ref: "a+b",
    session_id: "{CHECKOUT_SESSION_ID}",
    payment_intent: "pi_test",
    charge_id: "ch_test",
    purchase_session_id: "cs_plan",
    offer: "offer_test",
  });
  expect(validateSearch(parseSearch("?ref=first&ref=second")).ref).toBe(
    "first",
  );
});

async function mount(path: string, role: string) {
  persona.role = role;
  const history = createMemoryHistory({ initialEntries: ["/", path] });
  const router = createExampleRouter(history);
  await router.load();
  const view = render(<RouterProvider router={router} />);
  return { router, history, ...view };
}
it.each(["/marketplace/split", "/demo/destination-charge"])(
  "replaces legacy %s while retaining referral and unrelated query state",
  async (path) => {
    const { router, history } = await mount(
      `${path}?ref=avery&store=acct_test&extra=one&extra=two`,
      "visitor",
    );
    await screen.findByRole("heading", { name: "Storefront" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/stores"));
    expect(router.state.location.searchStr).toBe(
      "?ref=avery&store=acct_test&extra=one&extra=two",
    );
    expect(history.length).toBe(2);
    await act(async () => history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await act(async () => history.forward());
    await waitFor(() => expect(router.state.location.pathname).toBe("/stores"));
  },
);
it.each([
  ["/seller/onboarding", "setup"],
  ["/seller/marketplace-account", "stripe-settings"],
])("replaces legacy %s with its account section", async (path, section) => {
  const { router } = await mount(
    `${path}?section=details&example=embedded&purchase_session_id=cs_test`,
    "seller",
  );
  await screen.findByRole("heading", { name: "Seller account" });
  expect(router.state.location.pathname).toBe("/seller/account");
  expect(router.state.location.search).toMatchObject({
    section,
    example: "embedded",
    purchase_session_id: "cs_test",
  });
});
it("keeps role access checks ahead of restricted content and legacy redirects", async () => {
  const { router } = await mount("/seller/onboarding?ref=avery", "admin");
  await screen.findByRole("heading", { name: "Admin overview" });
  expect(router.state.location.pathname).toBe("/admin");
  expect(screen.queryByRole("heading", { name: "Seller account" })).toBeNull();
});
it("supports push, Back and Forward with direct-link query state", async () => {
  const { router, history } = await mount(
    "/stores?ref=avery&store=acct_test",
    "admin",
  );
  await act(async () => router.navigate({ to: "/admin/setup" }));
  expect(
    await screen.findByRole("heading", { name: "Admin setup" }),
  ).toBeVisible();
  await act(async () => history.back());
  await screen.findByRole("heading", { name: "Storefront" });
  expect(router.state.location.searchStr).toBe("?ref=avery&store=acct_test");
  await act(async () => history.forward());
  expect(
    await screen.findByRole("heading", { name: "Admin setup" }),
  ).toBeVisible();
});
