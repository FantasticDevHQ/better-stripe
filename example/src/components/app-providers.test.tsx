import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppToaster, ThemeHotkey, ThemeToggle } from "./app-providers";

const themeState = vi.hoisted(() => ({
  resolvedTheme: "light" as "light" | "dark" | undefined,
  setTheme: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => themeState,
}));

vi.mock("sonner", () => ({
  Toaster: ({ theme }: { theme: string }) => (
    <div data-testid="toaster" data-theme={theme} />
  ),
}));

afterEach(() => {
  themeState.resolvedTheme = "light";
  themeState.setTheme.mockReset();
});

describe("theme controls", () => {
  it("toggles theme with Ctrl+Shift+D and cleans up its listener", () => {
    const { unmount } = render(<ThemeHotkey />);

    fireEvent.keyDown(document, { key: "d", ctrlKey: true, shiftKey: true });
    expect(themeState.setTheme).toHaveBeenCalledWith("dark");

    unmount();
    themeState.setTheme.mockClear();
    fireEvent.keyDown(document, { key: "d", ctrlKey: true, shiftKey: true });
    expect(themeState.setTheme).not.toHaveBeenCalled();
  });

  it("ignores the theme shortcut while typing", () => {
    render(
      <>
        <ThemeHotkey />
        <input aria-label="Name" />
      </>,
    );

    fireEvent.keyDown(screen.getByLabelText("Name"), {
      key: "d",
      metaKey: true,
      shiftKey: true,
    });

    expect(themeState.setTheme).not.toHaveBeenCalled();
  });

  it("exposes the next theme and toggles from the button", () => {
    themeState.resolvedTheme = "dark";
    render(<ThemeToggle />);

    fireEvent.click(
      screen.getByRole("button", { name: "Switch to light theme" }),
    );
    expect(themeState.setTheme).toHaveBeenCalledWith("light");
  });

  it("keeps toast styling synchronized with the resolved theme", () => {
    themeState.resolvedTheme = "dark";
    render(<AppToaster />);

    expect(screen.getByTestId("toaster")).toHaveAttribute("data-theme", "dark");
  });
});
