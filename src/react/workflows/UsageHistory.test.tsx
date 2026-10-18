// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as ui from "../index.js";
import { usageScope } from "./Usage.fixtures.js";
afterEach(cleanup);
const page = (
  name: string,
  cursor: string | null = null,
  isDone = cursor === null,
) => ({
  status: "available" as const,
  observedAt: 700,
  value: { records: [{ id: name }], cursor, isDone },
});
it("loads bounded authorized pages and exposes the same pagination through render props", async () => {
  expect(ui.UsageHistory).toBeTypeOf("function");
  const load = vi
    .fn()
    .mockResolvedValueOnce(page("first", "next1"))
    .mockResolvedValueOnce(page("second"));
  render(
    <ui.UsageHistory
      scope={usageScope}
      historyKey="events"
      load={load}
      limit={5}
      getKey={(row: { id: string }) => row.id}
      renderRecord={(row) => <span>{row.id}</span>}
    />,
  );
  await screen.findByText("first");
  expect(load).toHaveBeenCalledWith(usageScope, { cursor: null, limit: 5 });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("second");
  expect(load).toHaveBeenLastCalledWith(usageScope, {
    cursor: "next1",
    limit: 5,
  });
  expect(
    (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
it("does not call an empty incomplete page complete or display unavailable history as zero", async () => {
  expect(ui.UsageHistory).toBeTypeOf("function");
  const load = vi
    .fn()
    .mockResolvedValueOnce({
      status: "available",
      observedAt: 700,
      value: { records: [], cursor: "more", isDone: false, complete: false },
    })
    .mockResolvedValueOnce({
      status: "unavailable",
      reason: "read_unavailable",
      retryable: true,
    });
  render(
    <ui.UsageHistory
      scope={usageScope}
      historyKey="credits"
      load={load}
      getKey={(row: { id: string }) => row.id}
      renderRecord={(row) => row.id}
    />,
  );
  await screen.findByText(/History incomplete/);
  expect(screen.queryByText(/No history/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText(/History unavailable/);
  expect(screen.queryByText(/No history/)).toBeNull();
});
it("resets cursor and drops late history after tenant and period switches", async () => {
  expect(ui.UsageHistory).toBeTypeOf("function");
  let finish!: (value: ReturnType<typeof page>) => void;
  const load = vi
    .fn()
    .mockResolvedValueOnce(page("original", "later"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(page("other tenant"));
  const props = {
    scope: usageScope,
    historyKey: "events",
    load,
    getKey: (row: { id: string }) => row.id,
    renderRecord: (row: { id: string }) => row.id,
  };
  const { rerender } = render(<ui.UsageHistory {...props} />);
  await screen.findByText("original");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  const scope = {
    ...usageScope,
    accountKey: "other",
    period: { start: 1200, end: 1800 },
  };
  rerender(<ui.UsageHistory {...props} scope={scope} />);
  await screen.findByText("other tenant");
  expect(load).toHaveBeenLastCalledWith(scope, { cursor: null, limit: 25 });
  await act(async () => finish(page("late original")));
  expect(screen.queryByText("late original")).toBeNull();
});

for (const cursor of ["", "c1"])
  it(`holds a nonterminal ${cursor ? "repeated" : "empty"} cursor and retains previous-page navigation`, async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(page("first", "c1"))
      .mockResolvedValueOnce(page("second", cursor, false))
      .mockResolvedValueOnce(page("first", "c1"));
    render(
      <ui.UsageHistory
        scope={usageScope}
        historyKey="events"
        load={load}
        getKey={(row: { id: string }) => row.id}
        renderRecord={(row) => row.id}
      />,
    );
    await screen.findByText("first");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("second");
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/History incomplete/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("first");
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
it("holds a cursor that loops back to any earlier page in the current navigation path", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(page("one", "c1"))
    .mockResolvedValueOnce(page("two", "c2"))
    .mockResolvedValueOnce(page("three", "c1"));
  render(
    <ui.UsageHistory
      scope={usageScope}
      historyKey="events"
      load={load}
      getKey={(row: { id: string }) => row.id}
      renderRecord={(row) => row.id}
    />,
  );
  for (const name of ["one", "two"]) {
    await screen.findByText(name);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }
  await screen.findByText("three");
  expect(
    (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText(/History incomplete/)).toBeTruthy();
});

it("supports keyboard-only history pagination through labelled native buttons", async () => {
  const user = userEvent.setup();
  const load = vi
    .fn()
    .mockResolvedValueOnce(page("first", "next"))
    .mockResolvedValueOnce(page("second"));
  render(
    <ui.UsageHistory
      scope={usageScope}
      historyKey="events"
      load={load}
      getKey={(row: { id: string }) => row.id}
      renderRecord={(row) => row.id}
    />,
  );
  await screen.findByText("first");
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Refresh history" }),
  );
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Next" }),
  );
  await user.keyboard("{Enter}");
  await screen.findByText("second");
});
