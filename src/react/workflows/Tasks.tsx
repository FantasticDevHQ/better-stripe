"use client";
import { useId, useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type WorkflowLogEntry = {
  id: number;
  timestamp: string;
  action: string;
  result: string;
  status: "success" | "error";
};
export type TaskRunnerOptions = {
  scopeKey?: string;
  maxEntries?: number;
  /** Explicitly select safe fields for display. Default never serializes returned secrets. */ formatResult?: (
    value: unknown,
  ) => string;
};
export function useTaskRunner({
  scopeKey = "tasks",
  maxEntries = 100,
  formatResult = () => "Completed",
}: TaskRunnerOptions = {}) {
  const initial = {
    scope: scopeKey,
    log: [] as WorkflowLogEntry[],
    results: {} as Record<string, string>,
    errors: {} as Record<string, string>,
  };
  const [state, setState] = useState(initial);
  if (state.scope !== scopeKey) setState(initial);
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const operation = useWorkflowAction(
    async (name: string, task: () => Promise<unknown>) => {
      setPendingOperation(name);
      try {
        return {
          name,
          status: "success" as const,
          value: await task(),
          error: null,
        };
      } catch (error) {
        return {
          name,
          status: "error" as const,
          value: undefined,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    scopeKey,
  );
  const run = async <T,>(
    name: string,
    task: () => Promise<T>,
  ): Promise<T | undefined> => {
    const result = await operation.run(name, task);
    if (!result) return undefined;
    let message: string;
    try {
      message =
        result.status === "error" ? result.error! : formatResult(result.value);
    } catch {
      message = "Completed";
    }
    setState((previous) => ({
      ...previous,
      log: [
        {
          id: (previous.log[0]?.id ?? 0) + 1,
          timestamp: new Date().toLocaleTimeString(),
          action: name,
          result: message,
          status: result.status,
        },
        ...previous.log,
      ].slice(0, Math.max(1, maxEntries)),
      results:
        result.status === "success"
          ? { ...previous.results, [name]: message }
          : previous.results,
      errors: {
        ...previous.errors,
        [name]: result.status === "error" ? message : "",
      },
    }));
    return result.status === "success" ? (result.value as T) : undefined;
  };
  return {
    log: state.log,
    results: state.results,
    errors: state.errors,
    isPending: operation.isPending,
    pendingOperation: operation.isPending ? pendingOperation : null,
    run,
    appendLog: (
      action: string,
      result: string,
      status: "success" | "error" = "success",
    ) =>
      setState((previous) => ({
        ...previous,
        log: [
          {
            id: (previous.log[0]?.id ?? 0) + 1,
            timestamp: new Date().toLocaleTimeString(),
            action,
            result,
            status,
          },
          ...previous.log,
        ].slice(0, Math.max(1, maxEntries)),
      })),
    clearLog: () => setState((previous) => ({ ...previous, log: [] })),
  };
}
export type WorkflowTask = {
  id: string;
  label: string;
  description?: string;
  run: () => Promise<unknown>;
  requiresConfirmation?: boolean;
};
export type WorkflowTasksProps = TaskRunnerOptions & {
  title?: string;
  tasks: WorkflowTask[];
  children?: (state: ReturnType<typeof useTaskRunner>) => ReactNode;
};
/** Unstyled administration/sandbox operations. Authorization and test-mode enforcement belong to the server callbacks. */
export function WorkflowTasks(props: WorkflowTasksProps) {
  const state = useTaskRunner(props);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const id = useId();
  if (props.children) return <>{props.children(state)}</>;
  return (
    <section data-better-stripe="workflow-tasks" aria-busy={state.isPending}>
      <h2>{props.title ?? "Stripe operations"}</h2>
      {props.tasks.map((task) => (
        <div key={task.id}>
          <h3>{task.label}</h3>
          {task.description && <p>{task.description}</p>}
          {task.requiresConfirmation && (
            <label htmlFor={`${id}-${task.id}`}>
              <input
                id={`${id}-${task.id}`}
                type="checkbox"
                checked={!!confirmed[task.id]}
                onChange={(event) =>
                  setConfirmed((previous) => ({
                    ...previous,
                    [task.id]: event.target.checked,
                  }))
                }
              />
              I understand and confirm this action.
            </label>
          )}
          <button
            type="button"
            disabled={
              state.isPending ||
              (task.requiresConfirmation && !confirmed[task.id])
            }
            onClick={() => {
              void state.run(task.id, task.run);
            }}
          >
            {state.pendingOperation === task.id ? "Processing…" : task.label}
          </button>
          {state.errors[task.id] ? (
            <p role="alert">{state.errors[task.id]}</p>
          ) : (
            state.results[task.id] && (
              <p role="status">{state.results[task.id]}</p>
            )
          )}
        </div>
      ))}
      <h3>Activity</h3>
      {!state.log.length ? (
        <p>No operations yet.</p>
      ) : (
        <ol>
          {state.log.map((entry) => (
            <li key={entry.id}>
              {entry.timestamp} · {entry.action} · {entry.result}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
export function StripeSetup(props: Omit<WorkflowTasksProps, "title">) {
  return <WorkflowTasks {...props} title="Stripe setup" />;
}
export function SandboxTesting(props: Omit<WorkflowTasksProps, "title">) {
  return <WorkflowTasks {...props} title="Sandbox testing" />;
}
