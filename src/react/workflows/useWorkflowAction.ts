"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
// Browser consumers may start actions in layout effects; initialize before those effects.
const useCommitEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type WorkflowActionState<T, Args extends unknown[]> = {
  isPending: boolean;
  error: string | null;
  result: T | undefined;
  /** Errors are exposed in state; failed and duplicate calls return undefined. */
  run: (...args: Args) => Promise<T | undefined>;
  reset: () => void;
};
/** Shared async action lifecycle. Scope identifies the authenticated account/resource, not authorization. */
export function useWorkflowAction<T, Args extends unknown[]>(
  action: (...args: Args) => Promise<T>,
  scope: string = "default",
  onSuccess?: (result: T) => void,
): WorkflowActionState<T, Args> {
  const initial = {
    scope,
    isPending: false,
    error: null as string | null,
    result: undefined as T | undefined,
  };
  const [state, setState] = useState(initial);
  if (state.scope !== scope) setState(initial);
  const callback = useRef(action);
  const success = useRef(onSuccess);
  const lifecycle = useRef({ version: 0, mounted: false });
  const lock = useRef<number | null>(null);
  useCommitEffect(() => {
    callback.current = action;
    success.current = onSuccess;
  }, [action, onSuccess]);
  useCommitEffect(() => {
    const version = ++lifecycle.current.version;
    lifecycle.current.mounted = true;
    lock.current = null;
    return () => {
      if (lifecycle.current.version === version) {
        lifecycle.current.mounted = false;
        lifecycle.current.version++;
        lock.current = null;
      }
    };
  }, [scope]);
  const reset = useCallback(() => {
    if (lock.current !== null) return;
    setState({ scope, isPending: false, error: null, result: undefined });
  }, [scope]);
  const run = useCallback(
    async (...args: Args) => {
      if (lock.current !== null) return undefined;
      const version = lifecycle.current.version;
      lock.current = version;
      setState({ scope, isPending: true, error: null, result: undefined });
      const current = () =>
        lifecycle.current.mounted && lifecycle.current.version === version;
      const complete = success.current;
      try {
        const result = await callback.current(...args);
        if (!current()) return undefined;
        complete?.(result);
        setState({ scope, isPending: false, error: null, result });
        return result;
      } catch (error) {
        if (current())
          setState({
            scope,
            isPending: false,
            error: error instanceof Error ? error.message : String(error),
            result: undefined,
          });
        return undefined;
      } finally {
        if (lock.current === version) lock.current = null;
      }
    },
    [scope],
  );
  return { ...state, run, reset };
}
