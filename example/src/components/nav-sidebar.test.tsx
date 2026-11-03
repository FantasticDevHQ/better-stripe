import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavSidebar } from "./nav-sidebar";

const persona = vi.hoisted(() => ({ currentRole: "admin" }));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({
    currentRole: persona.currentRole,
    currentUser: { id: "seller-1" },
    sellers: [{ id: "seller-1", name: "Test store" }],
    setSeller: vi.fn(),
  }),
}));

let desktop: MediaQueryList;
beforeEach(() => {
  persona.currentRole = "admin";
  desktop = Object.assign(new EventTarget(), {
    matches: false,
    media: "(min-width: 768px)",
  }) as MediaQueryList;
  vi.stubGlobal("matchMedia", () => desktop);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Location() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <NavSidebar />
      <button>Page action</button>
      <Location />
    </MemoryRouter>,
  );
}

describe("NavSidebar mobile navigation", () => {
  it("opens a named modal, focuses its close button and contains Tab in both directions", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.tab();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Mobile navigation" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const close = within(dialog).getByRole("button", {
      name: "Close navigation menu",
    });
    await waitFor(() => expect(close).toHaveFocus());
    await user.tab({ shift: true });
    const links = within(dialog).getAllByRole("link");
    await waitFor(() => expect(links.at(-1)).toHaveFocus());
    await user.tab();
    await waitFor(() => expect(close).toHaveFocus());
    for (let i = 0; i < links.length; i++) {
      await user.tab();
      await waitFor(() =>
        expect(dialog).toContainElement(document.activeElement as HTMLElement),
      );
    }
    await user.tab();
    await waitFor(() => expect(close).toHaveFocus());
  });

  it("dismisses with Escape and restores the trigger for keyboard reopening", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const trigger = screen.getByRole("button", {
      name: "Open navigation menu",
    });
    await user.tab();
    await user.keyboard("{Enter}{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("dialog", { name: "Mobile navigation" }),
    ).toBeInTheDocument();
  });

  it("releases the modal at the desktop breakpoint and does not reopen on mobile", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );
    act(() => {
      Object.defineProperty(desktop, "matches", {
        value: true,
        configurable: true,
      });
      desktop.dispatchEvent(new Event("change"));
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("navigation", { name: "Mobile navigation" }),
      ).not.toBeInTheDocument(),
    );
    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    await waitFor(() =>
      expect(
        within(navigation).getByRole("link", { name: "Home" }),
      ).toHaveFocus(),
    );
    await user.tab();
    expect(navigation).toContainElement(document.activeElement as HTMLElement);
    act(() => {
      Object.defineProperty(desktop, "matches", {
        value: false,
        configurable: true,
      });
      desktop.dispatchEvent(new Event("change"));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["backdrop", "close button"])(
    "dismisses from the %s and restores focus",
    async (control) => {
      const user = userEvent.setup();
      renderSidebar();
      const trigger = screen.getByRole("button", {
        name: "Open navigation menu",
      });
      await user.click(trigger);
      await waitFor(() =>
        expect(
          within(screen.getByRole("dialog")).getByRole("button", {
            name: "Close navigation menu",
          }),
        ).toHaveFocus(),
      );
      const controls = screen.getAllByRole("button", {
        name: "Close navigation menu",
        hidden: true,
      });
      await user.click(controls[control === "backdrop" ? 0 : 1]);
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );

  it.each([
    ["Home", "/"],
    ["Setup", "/admin/setup"],
  ])("closes after keyboard navigation to %s", async (name, path) => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );
    const navigation = screen.getByRole("navigation", {
      name: "Mobile navigation",
    });
    const link = within(navigation).getByRole("link", { name });
    await waitFor(() =>
      expect(
        within(navigation).getByRole("button", {
          name: "Close navigation menu",
        }),
      ).toHaveFocus(),
    );
    for (
      let i = 0;
      i < within(navigation).getAllByRole("link").length &&
      document.activeElement !== link;
      i++
    )
      await user.tab();
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Current path")).toHaveTextContent(path);
  });

  it("keeps the seller selector in the modal keyboard order", async () => {
    persona.currentRole = "seller";
    const user = userEvent.setup();
    renderSidebar();
    await user.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Mobile navigation" });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Close navigation menu" }),
      ).toHaveFocus(),
    );
    await user.tab();
    expect(within(dialog).getByRole("link", { name: "Home" })).toHaveFocus();
    await user.tab();
    expect(
      within(dialog).getByRole("combobox", { name: "Seller persona" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
