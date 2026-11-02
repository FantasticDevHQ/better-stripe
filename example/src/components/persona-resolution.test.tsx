import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "@/test/router";
import { useLocation } from "@/test/router-location";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RoleProvider, useRole } from "@/providers/role-context";
import { ThemeContext } from "@/providers/use-theme";
const data = vi.hoisted(() => ({ users: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => data.users }));
beforeEach(() => {
  localStorage.clear();
  window.scrollTo = vi.fn();
  window.matchMedia = vi
    .fn()
    .mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
});
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
    { wrapper: MemoryRouter },
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
    { wrapper: MemoryRouter },
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose Sasha" }));
  expect(screen.getByText("seller:sasha:acct_sasha")).toBeInTheDocument();
});

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

it.each(
  [
    { role: "customer", restricted: "/dashboard" },
    { role: "seller", restricted: "/seller/sales" },
    { role: "affiliate", restricted: "/affiliate" },
  ].flatMap(({ role, restricted }) =>
    ["/", "/stores", restricted].flatMap((path) =>
      [false, true].map((seededAdmin) => ({ role, path, seededAdmin })),
    ),
  ),
)(
  "opens setup as Admin for missing $role from $path with seededAdmin=$seededAdmin",
  async ({ role, path, seededAdmin }) => {
    localStorage.setItem("betterlearn-role", role);
    data.users = seededAdmin
      ? [
          {
            _id: "admin",
            name: "Admin",
            email: "admin@example.com",
            role: "admin",
          },
        ]
      : [];
    const root = createRootRoute({
      component: () => (
        <ThemeContext.Provider
          value={{ theme: "light", resolvedTheme: "light", setTheme: () => {} }}
        >
          <CurrentPath />
          <RoleProvider>
            <AppShell />
          </RoleProvider>
        </ThemeContext.Provider>
      ),
    });
    const setup = createRoute({
      getParentRoute: () => root,
      path: "/admin/setup",
      component: Persona,
    });
    const original = createRoute({
      getParentRoute: () => root,
      path: "$",
      component: () => <p>Original destination</p>,
    });
    const router = createRouter({
      routeTree: root.addChildren([setup, original]),
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole("button", { name: "Open admin setup" }));

    await screen.findByText(seededAdmin ? "admin:admin:" : "admin::");
    expect(screen.getByLabelText("Current path")).toHaveTextContent(
      /^\/admin\/setup$/,
    );
    expect(localStorage.getItem("betterlearn-role")).toBe("admin");
    expect(
      await screen.findByText(seededAdmin ? "admin:admin:" : "admin::"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Original destination")).not.toBeInTheDocument();
  },
);
