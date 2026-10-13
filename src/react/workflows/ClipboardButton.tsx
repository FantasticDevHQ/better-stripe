"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type ClipboardButtonProps = {
  text: string;
  label?: string;
  copiedLabel?: string;
  resetAfterMs?: number;
  writeText?: (text: string) => Promise<void>;
  children?: (state: {
    copy: () => Promise<void>;
    copied: boolean;
    isPending: boolean;
    error: string | null;
    label: string;
  }) => ReactNode;
};
export function ClipboardButton({
  text,
  label = "Copy",
  copiedLabel = "Copied!",
  resetAfterMs = 2000,
  writeText = (text) => navigator.clipboard.writeText(text),
  children,
}: ClipboardButtonProps) {
  const action = useWorkflowAction(async () => {
    await writeText(text);
    return text;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const copied = action.result === text;
  const copy = async () => {
    const result = await action.run();
    if (result !== undefined) {
      clearTimeout(timer.current);
      timer.current = setTimeout(action.reset, resetAfterMs);
    }
  };
  const state = {
    copy,
    copied,
    isPending: action.isPending,
    error: action.error,
    label: copied ? copiedLabel : label,
  };
  if (children) return <>{children(state)}</>;
  return (
    <span data-better-stripe="clipboard">
      <button
        type="button"
        disabled={state.isPending}
        onClick={() => {
          void copy();
        }}
      >
        {state.label}
      </button>
      {state.error && <span role="alert">{state.error}</span>}
    </span>
  );
}
