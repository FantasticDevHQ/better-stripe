// @vitest-environment jsdom
import { StrictMode, useLayoutEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkflowAction } from "./useWorkflowAction.js";

afterEach(cleanup);

function ActionConsumer({
  startsDuringCommit,
}: {
  startsDuringCommit: boolean;
}) {
  const observation = useWorkflowAction(async () => "observed", "original");
  useLayoutEffect(() => {
    if (startsDuringCommit) void observation.run();
  }, [startsDuringCommit, observation.run]);
  return (
    <div>
      <button
        onClick={() => {
          void observation.run();
        }}
      >
        Observe
      </button>
      <p>
        {observation.isPending ? "pending" : (observation.result ?? "idle")}
      </p>
    </div>
  );
}

it("completes an ordinary event-started workflow action", async () => {
  render(<ActionConsumer startsDuringCommit={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Observe" }));
  expect((await screen.findByText("observed")).textContent).toBe("observed");
  expect(screen.queryByText("pending")).toBeNull();
});

it("completes an action started by a consumer layout effect", async () => {
  render(<ActionConsumer startsDuringCommit />);
  expect((await screen.findByText("observed")).textContent).toBe("observed");
  expect(screen.queryByText("pending")).toBeNull();
});

it("completes the current commit-started action through StrictMode replay", async () => {
  render(
    <StrictMode>
      <ActionConsumer startsDuringCommit />
    </StrictMode>,
  );
  expect((await screen.findByText("observed")).textContent).toBe("observed");
  expect(screen.queryByText("pending")).toBeNull();
});

it("uses the current callback when a layout effect starts work after rerender", async () => {
  const first = vi.fn(async () => "first");
  const second = vi.fn(async () => "second");
  const { result, rerender } = renderHook(
    ({ action }) => {
      const observation = useWorkflowAction(action);
      useLayoutEffect(() => {
        void observation.run();
      }, [action, observation.run]);
      return observation;
    },
    { initialProps: { action: first } },
  );
  await act(async () => {});
  expect(result.current.result).toBe("first");
  rerender({ action: second });
  await act(async () => {});
  expect(result.current.result).toBe("second");
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});

it("does not call success after a pending consumer unmounts", async () => {
  let complete!: (value: string) => void;
  const onSuccess = vi.fn();
  const { result, unmount } = renderHook(() =>
    useWorkflowAction(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
      "original",
      onSuccess,
    ),
  );
  let pending!: Promise<string | undefined>;
  act(() => {
    pending = result.current.run();
  });
  unmount();
  await act(async () => {
    complete("discarded");
    expect(await pending).toBeUndefined();
  });
  expect(onSuccess).not.toHaveBeenCalled();
});
