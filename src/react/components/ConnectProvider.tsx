"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import type { IStripeConnectInitParams } from "@stripe/connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js/pure.js";
import { ConnectComponentsProvider } from "@stripe/react-connect-js";

export type ConnectProviderProps = {
  /** Stripe publishable key */
  publishableKey: string;
  /**
   * Fetches a fresh Account Session client secret. Wire this to a Convex
   * action calling `stripe.createDisputeSession({ stripeAccountId })`
   * (BTS-30) and return its `clientSecret`. The Connect runtime calls it on
   * initialization and again whenever the session expires — it is never
   * called during render.
   */
  fetchClientSecret: () => Promise<string>;
  /** Appearance options forwarded to Connect embedded components. */
  appearance?: IStripeConnectInitParams["appearance"];
  /** Locale forwarded to Connect embedded components. */
  locale?: IStripeConnectInitParams["locale"];
  children?: ReactNode;
};

/**
 * Provider for Stripe Connect embedded components (BTS-55). Initializes
 * ConnectJS once per mount with the account-session fetcher and makes the
 * instance available to embedded components like {@link EmbeddedDisputes}.
 *
 * ConnectJS renders client-only iframes; on the server this component renders
 * its tree but the embedded surfaces only materialize in the browser.
 */
export function ConnectProvider(props: ConnectProviderProps) {
  return <ConnectInstanceProvider key={props.publishableKey} {...props} />;
}
function ConnectInstanceProvider({
  publishableKey,
  fetchClientSecret,
  appearance,
  locale,
  children,
}: ConnectProviderProps) {
  const fetcher = useRef(fetchClientSecret);
  useEffect(() => {
    fetcher.current = fetchClientSecret;
  }, [fetchClientSecret]);
  // Lazy useState initializer: exactly one Connect instance per mount, stable
  // across re-renders (loadConnectAndInitialize returns synchronously).
  const [connectInstance] = useState(() =>
    loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: () => fetcher.current(),
      ...(appearance !== undefined ? { appearance } : {}),
      ...(locale !== undefined ? { locale } : {}),
    }),
  );

  useEffect(() => {
    if (appearance !== undefined || locale !== undefined)
      connectInstance.update({
        ...(appearance !== undefined ? { appearance } : {}),
        ...(locale !== undefined ? { locale } : {}),
      });
  }, [connectInstance, appearance, locale]);
  return (
    <ConnectComponentsProvider connectInstance={connectInstance}>
      {children}
    </ConnectComponentsProvider>
  );
}
