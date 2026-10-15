"use client";
import { useId, useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";

export type EvidenceUploadProps = {
  /** Include the authenticated scope and selected dispute. */
  scopeKey: string;
  /** Host authorizes the dispute and uploads bytes through BetterStripe server-side. */
  onUpload: (file: File) => Promise<unknown>;
  children?: (state: {
    file: File | undefined;
    setFile: (file: File | undefined) => void;
    upload: () => Promise<unknown>;
    isPending: boolean;
    error: string | null;
    isAttached: boolean;
  }) => ReactNode;
};

/** Uploading only attaches to the draft. EvidenceForm owns explicit submission. */
export function EvidenceUpload(props: EvidenceUploadProps) {
  return <EvidenceUploadBody key={props.scopeKey} {...props} />;
}
function EvidenceUploadBody(props: EvidenceUploadProps) {
  const id = useId();
  const [file, setFile] = useState<File>();
  const action = useWorkflowAction(async () => {
    if (!file) throw new Error("Choose an evidence file first.");
    await props.onUpload(file);
    return true;
  }, props.scopeKey);
  const state = {
    file,
    setFile: (file: File | undefined) => {
      setFile(file);
      action.reset();
    },
    upload: action.run,
    isPending: action.isPending,
    error: action.error,
    isAttached: action.result === true,
  };
  if (props.children) return <>{props.children(state)}</>;
  return (
    <section data-better-stripe="evidence-upload" aria-busy={state.isPending}>
      <label htmlFor={id}>Evidence file</label>
      <input
        id={id}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        disabled={state.isPending}
        onChange={(event) => state.setFile(event.target.files?.[0])}
      />
      <button
        type="button"
        disabled={!file || state.isPending}
        onClick={() => {
          void state.upload();
        }}
      >
        {state.isPending ? "Uploading…" : "Attach to draft"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.isAttached && (
        <p role="status">
          File attached to draft. Submit evidence separately when ready.
        </p>
      )}
    </section>
  );
}
