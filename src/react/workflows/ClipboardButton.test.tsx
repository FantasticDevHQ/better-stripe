// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClipboardButton } from "./ClipboardButton.js";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("copies on demand, restores its label, and catches denied clipboard access", async () => {
  vi.useFakeTimers();
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Clipboard denied"));
  render(<ClipboardButton text="pnpm check:all" writeText={writeText} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  });
  expect(writeText).toHaveBeenCalledWith("pnpm check:all");
  expect(screen.getByText("Copied!")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  });
  expect(screen.getByRole("alert").textContent).toContain("Clipboard denied");
});
