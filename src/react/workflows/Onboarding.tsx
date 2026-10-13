"use client";
import { useId, useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { Connect, type ConnectProps } from "./Connect.js";
import { AccountOnboardingCard } from "../components/AccountOnboardingCard.js";
export type OnboardingActions = {
  scopeKey: string;
  initialCountry?: string;
  createAccount: (country: string) => Promise<{ onboardingUrl?: string }>;
  continueOnboarding: () => Promise<{ url?: string }>;
  closeAccount?: () => Promise<unknown>;
  onNavigate?: (url: string) => void;
};
export function useOnboarding(props: OnboardingActions) {
  const [fields, setFields] = useState({
    scope: props.scopeKey,
    country: props.initialCountry ?? "US",
  });
  if (fields.scope !== props.scopeKey)
    setFields({ scope: props.scopeKey, country: props.initialCountry ?? "US" });
  const [operation, setOperation] = useState<"create" | "link" | "close">(
    "create",
  );
  const action = useWorkflowAction(
    async (type: "create" | "link" | "close") => {
      setOperation(type);
      if (type === "close") {
        if (!props.closeAccount)
          throw new Error("Account closing is not configured.");
        await props.closeAccount();
        return true;
      }
      const result =
        type === "create"
          ? await props.createAccount(fields.country)
          : await props.continueOnboarding();
      const url =
        "onboardingUrl" in result
          ? result.onboardingUrl
          : "url" in result
            ? result.url
            : undefined;
      if (!url) throw new Error("Stripe did not return an onboarding URL.");
      (props.onNavigate ?? ((url) => window.location.assign(url)))(url);
      return true;
    },
    props.scopeKey,
  );
  const run = action.run;
  return {
    selectedCountry: fields.country,
    setSelectedCountry: (country: string) =>
      setFields((previous) => ({ ...previous, country })),
    isPending: action.isPending,
    isCreating: action.isPending && operation === "create",
    isLinking: action.isPending && operation === "link",
    isRestarting: action.isPending && operation === "close",
    error: action.error,
    createError: operation === "create" ? action.error : null,
    linkError: operation === "link" ? action.error : null,
    restartError: operation === "close" ? action.error : null,
    create: () => run("create"),
    continue: () => run("link"),
    close: () => run("close"),
  };
}
export type OnboardingAccount = {
  stripeAccountId: string;
  onboardingStatus?: string;
  missingRequirements?: string[];
  email?: string;
  country?: string;
};
export type OnboardingRenderProps = ReturnType<typeof useOnboarding> & {
  account: OnboardingAccount | null | undefined;
};
export type OnboardingProps =
  | (OnboardingActions & {
      presentation?: "headless";
      account: OnboardingAccount | null | undefined;
      countries?: { code: string; name: string }[];
      children?: (state: OnboardingRenderProps) => ReactNode;
    })
  | (Omit<ConnectProps, "component"> & { presentation: "embedded" });
export function Onboarding(props: OnboardingProps) {
  return props.presentation === "embedded" ? (
    <Connect {...props} component="onboarding" />
  ) : (
    <OnboardingBody key={props.scopeKey} {...props} />
  );
}
function OnboardingBody(props: Extract<OnboardingProps, { account: unknown }>) {
  const state = useOnboarding(props);
  const id = useId();
  if (props.children)
    return <>{props.children({ ...state, account: props.account })}</>;
  if (props.account === undefined) return <p role="status">Loading account…</p>;
  const status = props.account?.onboardingStatus;
  const normalized =
    status === "complete" || status === "in_progress" || status === "restricted"
      ? status
      : "pending";
  return (
    <section data-better-stripe="onboarding" aria-busy={state.isPending}>
      <h2>Account setup</h2>
      {state.error && <p role="alert">{state.error}</p>}
      {!props.account ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void state.create();
          }}
        >
          <label htmlFor={id}>Country</label>
          <select
            id={id}
            required
            value={state.selectedCountry}
            onChange={(event) => state.setSelectedCountry(event.target.value)}
          >
            {(props.countries ?? [{ code: "US", name: "United States" }]).map(
              (country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ),
            )}
          </select>
          <button type="submit" disabled={state.isPending}>
            {state.isCreating ? "Creating account…" : "Create account"}
          </button>
        </form>
      ) : (
        <>
          <p>{props.account.stripeAccountId}</p>
          <AccountOnboardingCard
            status={normalized}
            missingRequirements={props.account.missingRequirements}
            onContinue={() => {
              void state.continue();
            }}
            isLoading={state.isPending}
          />
          {props.closeAccount && (
            <details>
              <summary>Close account</summary>
              <p>Closing a Stripe account is irreversible.</p>
              <button
                type="button"
                disabled={state.isPending}
                onClick={() => {
                  void state.close();
                }}
              >
                {state.isRestarting ? "Closing…" : "Close account"}
              </button>
            </details>
          )}
        </>
      )}
    </section>
  );
}
