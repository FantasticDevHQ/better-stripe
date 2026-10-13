"use client";
import { useState, type ReactNode } from "react";
import { CHECKOUT_OPTIONS } from "./checkout-options.js";
import type { CheckoutMode } from "./Checkout.js";
export type CheckoutOption = (typeof CHECKOUT_OPTIONS)[number];
export type CheckoutChooserState = {
  options: typeof CHECKOUT_OPTIONS;
  selected: CheckoutOption;
  unsupported: boolean;
  select: (mode: CheckoutMode) => void;
};
export type CheckoutChooserProps = {
  value?: CheckoutMode;
  defaultValue?: CheckoutMode;
  onValueChange?: (mode: CheckoutMode) => void;
  recurring?: boolean;
  children?: (state: CheckoutChooserState) => ReactNode;
};
/** Checkout tradeoffs and mode selection, independent of routing and session creation. */
export function CheckoutChooser({
  value,
  defaultValue = "embedded",
  onValueChange,
  recurring = false,
  children,
}: CheckoutChooserProps) {
  const [internal, setInternal] = useState(defaultValue);
  const selected =
    CHECKOUT_OPTIONS.find((option) => option.id === (value ?? internal)) ??
    CHECKOUT_OPTIONS[1];
  const select = (mode: CheckoutMode) => {
    setInternal(mode);
    onValueChange?.(mode);
  };
  const state = {
    options: CHECKOUT_OPTIONS,
    selected,
    select,
    unsupported: recurring && selected.id === "payment-intent",
  };
  if (children) return <>{children(state)}</>;
  return (
    <section data-better-stripe="checkout-chooser">
      <h2>Choose your checkout type</h2>
      <div role="group" aria-label="Checkout types">
        {state.options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected.id === option.id}
            onClick={() => select(option.id)}
          >
            {option.title}
          </button>
        ))}
      </div>
      <h3>{selected.title}</h3>
      <p>{selected.api}</p>
      <dl>
        <dt>Pros</dt>
        <dd>{selected.pros}</dd>
        <dt>Cons</dt>
        <dd>{selected.cons}</dd>
      </dl>
      <a href={selected.docs} target="_blank" rel="noreferrer">
        Stripe documentation
      </a>
      {selected.id === "form" && <p>Preview</p>}
      {state.unsupported && (
        <p role="status">
          Payment Intents alone do not create subscriptions. Choose a Checkout
          Sessions integration for a recurring product.
        </p>
      )}
    </section>
  );
}
