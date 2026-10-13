"use client";
import { useCallback, useEffect, useRef, useState } from "react";
/** Loads once per scope/refresh, including under React StrictMode. Stale requests cannot update another scope. */
export function useWorkflowResource<T>(
  load: () => Promise<T>,
  scope = "default",
) {
  const initial = {
    scope,
    attempt: 0,
    data: undefined as T | undefined,
    error: null as string | null,
    isLoading: true,
  };
  const [state, setState] = useState(initial);
  if (state.scope !== scope) setState(initial);
  const loader = useRef(load);
  const request = useRef<{
    scope: string;
    attempt: number;
    promise: Promise<T>;
  } | null>(null);
  useEffect(() => {
    loader.current = load;
  }, [load]);
  useEffect(() => {
    let active = true;
    if (
      !request.current ||
      request.current.scope !== scope ||
      request.current.attempt !== state.attempt
    ) {
      request.current = {
        scope,
        attempt: state.attempt,
        promise: Promise.resolve().then(() => loader.current()),
      };
    }
    void request.current.promise
      .then((data) => {
        if (active)
          setState((previous) => ({
            ...previous,
            data,
            error: null,
            isLoading: false,
          }));
      })
      .catch((error: unknown) => {
        if (active)
          setState((previous) => ({
            ...previous,
            error: error instanceof Error ? error.message : String(error),
            isLoading: false,
          }));
      });
    return () => {
      active = false;
    };
  }, [scope, state.attempt]);
  const refresh = useCallback(
    () =>
      setState((previous) => ({
        ...previous,
        attempt: previous.attempt + 1,
        isLoading: true,
        error: null,
      })),
    [],
  );
  return {
    revision: state.attempt,
    data: state.data,
    error: state.error,
    isLoading: state.isLoading,
    refresh,
  };
}
