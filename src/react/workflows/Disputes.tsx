"use client";
import { useState, type ReactNode } from "react";
import {
  DisputesList,
  type DisputesListRow,
} from "../components/DisputesList.js";
import {
  DisputeDetail,
  canRespondToDispute,
} from "../components/DisputeDetail.js";
import {
  EvidenceForm,
  type EvidenceFormUpdateArgs,
} from "../components/EvidenceForm.js";
import type { DisputeWithCountdown } from "../hooks/useDisputeWithCountdown.js";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { Connect, type ConnectProps } from "./Connect.js";
export type DisputeResponseOptions = {
  scopeKey: string;
  acceptDispute?: (stripeDisputeId: string) => Promise<unknown>;
  onSelectionChange?: (id: string | undefined) => void;
};
export function useDisputeResponse(props: DisputeResponseOptions) {
  const initial = {
    scope: props.scopeKey,
    selectedId: undefined as string | undefined,
    confirming: false,
  };
  const [state, setState] = useState(initial);
  if (state.scope !== props.scopeKey) setState(initial);
  const action = useWorkflowAction(
    async () => {
      if (!state.selectedId || !state.confirming)
        throw new Error("Confirm accepting this dispute first.");
      if (!props.acceptDispute)
        throw new Error("Dispute acceptance is not configured.");
      await props.acceptDispute(state.selectedId);
      return true;
    },
    `${props.scopeKey}:${state.selectedId ?? ""}`,
  );
  return {
    selectedId: state.selectedId,
    setSelectedId: (selectedId: string | undefined) => {
      setState((previous) => ({ ...previous, selectedId, confirming: false }));
      props.onSelectionChange?.(selectedId);
      action.reset();
    },
    acceptStatus: action.isPending
      ? ("submitting" as const)
      : action.result
        ? ("accepted" as const)
        : action.error
          ? ("error" as const)
          : state.confirming
            ? ("confirming" as const)
            : ("idle" as const),
    acceptError: action.error,
    isPending: action.isPending,
    requestAccept: () => {
      action.reset();
      setState((previous) => ({ ...previous, confirming: true }));
    },
    cancelAccept: () => {
      action.reset();
      setState((previous) => ({ ...previous, confirming: false }));
    },
    accept: action.run,
  };
}
export type DisputesRenderProps = ReturnType<typeof useDisputeResponse> & {
  disputes: DisputesListRow[] | undefined;
  detail: DisputeWithCountdown | null | undefined;
};
export type HeadlessDisputesProps = DisputeResponseOptions & {
  presentation?: "headless";
  disputes: DisputesListRow[] | undefined;
  detail?: DisputeWithCountdown | null;
  onUpdateEvidence: (args: EvidenceFormUpdateArgs) => Promise<unknown>;
  children?: (state: DisputesRenderProps) => ReactNode;
};
export type DisputesProps =
  | HeadlessDisputesProps
  | (Omit<ConnectProps, "component"> & { presentation: "embedded" });
export function Disputes(props: DisputesProps) {
  return props.presentation === "embedded" ? (
    <Connect {...props} component="disputes" />
  ) : (
    <DisputesBody key={props.scopeKey} {...props} />
  );
}
function DisputesBody(props: HeadlessDisputesProps) {
  const state = useDisputeResponse(props);
  const detail =
    props.detail?.stripeDisputeId === state.selectedId
      ? props.detail
      : undefined;
  if (props.children)
    return (
      <>{props.children({ ...state, disputes: props.disputes, detail })}</>
    );
  return (
    <section data-better-stripe="disputes">
      <h2>Disputes</h2>
      <DisputesList
        disputes={props.disputes}
        isLoading={props.disputes === undefined}
        renderRow={(row) => (
          <button
            key={row.dispute.stripeDisputeId}
            type="button"
            aria-pressed={state.selectedId === row.dispute.stripeDisputeId}
            onClick={() => state.setSelectedId(row.dispute.stripeDisputeId)}
          >
            {row.dispute.stripeDisputeId} · {row.dispute.status} {row.badgeText}
          </button>
        )}
      />
      {!state.selectedId ? (
        <p>Select a dispute to respond.</p>
      ) : (
        <>
          <DisputeDetail dispute={detail} isLoading={!detail} />
          {canRespondToDispute(detail?.status) && (
            <>
              {props.acceptDispute &&
                (state.acceptStatus === "confirming" ? (
                  <div>
                    <p>
                      Accepting permanently closes this dispute. This cannot be
                      undone.
                    </p>
                    <button
                      type="button"
                      disabled={state.isPending}
                      onClick={() => {
                        void state.accept();
                      }}
                    >
                      Yes, accept dispute
                    </button>
                    <button type="button" onClick={state.cancelAccept}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={
                      state.isPending || state.acceptStatus === "accepted"
                    }
                    onClick={state.requestAccept}
                  >
                    {state.isPending
                      ? "Accepting…"
                      : state.acceptStatus === "accepted"
                        ? "Dispute accepted"
                        : "Accept dispute"}
                  </button>
                ))}
              {state.acceptError && <p role="alert">{state.acceptError}</p>}
              <EvidenceForm
                key={state.selectedId}
                stripeDisputeId={state.selectedId}
                onUpdateDispute={props.onUpdateEvidence}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
