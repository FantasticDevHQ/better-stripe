// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { Pagination, useCursorPagination } from "./Pagination.js";
afterEach(cleanup);
it("navigates cursor history and resets when the account changes", async () => {
  function View({ account }: { account: string }) {
    const state = useCursorPagination(account);
    return (
      <>
        <output>{state.cursor ?? "first"}</output>
        <Pagination
          page={state.page}
          canPrevious={state.canPrevious}
          canNext={state.page < 3}
          onPrevious={state.previous}
          onNext={() => state.next(`cursor-${state.page}`)}
        />
      </>
    );
  }
  const { rerender } = render(<View account="a" />);
  expect(
    screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled"),
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("cursor-1")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Page 3")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Next" }).hasAttribute("disabled"),
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText("cursor-1")).toBeTruthy();
  rerender(<View account="b" />);
  expect(screen.getByText("Page 1")).toBeTruthy();
  expect(screen.getByText("first")).toBeTruthy();
});
it("disables navigation while a page is loading", () => {
  render(
    <Pagination
      page={2}
      canPrevious
      canNext
      isLoading
      onPrevious={() => {}}
      onNext={() => {}}
    />,
  );
  for (const button of screen.getAllByRole("button"))
    expect(button.hasAttribute("disabled")).toBe(true);
});
