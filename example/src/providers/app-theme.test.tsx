import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppThemeProvider } from "./app-theme";
import { useTheme } from "./use-theme";
function Controls() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {resolvedTheme}
    </button>
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("applies saved theme, persists toggles, and renders no script element", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  localStorage.setItem("theme", "dark");
  const view = render(
    <AppThemeProvider>
      <Controls />
    </AppThemeProvider>,
  );
  expect(document.documentElement).toHaveClass("dark");
  expect(view.container.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "dark" }));
  expect(document.documentElement).toHaveClass("light");
  expect(localStorage.getItem("theme")).toBe("light");
});
it("follows system changes and synchronizes theme changes from another tab", () => {
  let listener: () => void = () => {};
  const media = {
    matches: false,
    addEventListener: vi.fn((_name, fn) => {
      listener = fn;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => media);
  const view = render(
    <AppThemeProvider>
      <Controls />
    </AppThemeProvider>,
  );
  act(() => {
    media.matches = true;
    listener();
  });
  expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
  localStorage.setItem("theme", "light");
  fireEvent(window, new StorageEvent("storage", { key: "theme" }));
  expect(screen.getByRole("button", { name: "light" })).toBeInTheDocument();
  view.unmount();
  expect(media.removeEventListener).toHaveBeenCalled();
});
