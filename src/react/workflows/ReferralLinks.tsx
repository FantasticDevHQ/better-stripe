"use client";
import type { ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
export type ReferralLink = { id: string; label: string; url: string };
export function useReferralLinks({
  scopeKey = "referral-links",
  writeText = (text: string) => navigator.clipboard.writeText(text),
}: { scopeKey?: string; writeText?: (text: string) => Promise<void> } = {}) {
  const action = useWorkflowAction(async (url: string) => {
    if (!url.trim()) throw new Error("A referral URL is required.");
    await writeText(url);
    return url;
  }, scopeKey);
  return {
    copy: action.run,
    copiedUrl: action.result,
    error: action.error,
    isPending: action.isPending,
  };
}
export type ReferralLinksProps = {
  links: ReferralLink[] | undefined;
  scopeKey?: string;
  writeText?: (text: string) => Promise<void>;
  children?: (
    state: ReturnType<typeof useReferralLinks> & {
      links: ReferralLink[];
      isLoading: boolean;
    },
  ) => ReactNode;
};
export function ReferralLinks(props: ReferralLinksProps) {
  const state = useReferralLinks(props);
  if (props.children)
    return (
      <>
        {props.children({
          ...state,
          links: props.links ?? [],
          isLoading: props.links === undefined,
        })}
      </>
    );
  return (
    <section data-better-stripe="referral-links">
      <h2>Referral links</h2>
      {state.error && <p role="alert">{state.error}</p>}
      {state.copiedUrl && <p role="status">Referral link copied</p>}
      {props.links === undefined ? (
        <p role="status">Loading referral links…</p>
      ) : !props.links.length ? (
        <p>No referral links yet.</p>
      ) : (
        <ul>
          {props.links.map((link) => (
            <li key={link.id}>
              <a href={link.url}>{link.label}</a>
              <p>{link.url}</p>
              <button
                type="button"
                disabled={state.isPending}
                aria-label={`Copy referral link for ${link.label}`}
                onClick={() => {
                  void state.copy(link.url);
                }}
              >
                {state.isPending ? "Copying…" : "Copy link"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
