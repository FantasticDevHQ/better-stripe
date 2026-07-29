import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { NavSidebar } from "./nav-sidebar";

vi.mock("@/providers/role-context", () => ({
  useRole: () => ({ currentRole: "admin" }),
}));

function renderSidebar() {
  return render(
    <MemoryRouter>
      <NavSidebar />
    </MemoryRouter>,
  );
}

describe("NavSidebar mobile navigation", () => {
  it("opens and closes from both close controls", () => {
    renderSidebar();

    fireEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );
    expect(
      screen.getByRole("navigation", { name: "Mobile navigation" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Close navigation menu" })[0],
    );
    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Close navigation menu" })[1],
    );
    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
  });

  it("shows role-specific links and closes after navigation", () => {
    renderSidebar();
    fireEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );

    const mobileNavigation = screen.getByRole("navigation", {
      name: "Mobile navigation",
    });
    fireEvent.click(
      within(mobileNavigation).getByRole("link", { name: "Setup" }),
    );

    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
  });
});
