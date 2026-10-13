"use client";
import { useState, type ReactNode } from "react";
export type IntegrationMode = "headless" | "components" | "embedded" | "hosted";
const labels: Record<IntegrationMode, string> = {
  headless: "Headless",
  components: "Components",
  embedded: "Stripe embedded",
  hosted: "Stripe hosted",
};
export type IntegrationSwitchState = {
  value: IntegrationMode;
  select: (mode: IntegrationMode) => void;
  options: { value: IntegrationMode; label: string }[];
  content: ReactNode;
};
export type IntegrationSwitchProps = {
  views: Partial<Record<IntegrationMode, ReactNode>> & { headless: ReactNode };
  value?: IntegrationMode;
  defaultValue?: IntegrationMode;
  onValueChange?: (mode: IntegrationMode) => void;
  children?: (state: IntegrationSwitchState) => ReactNode;
};
/** Only the active integration is mounted. No router or styling dependencies. */
export function IntegrationSwitch({
  views,
  value,
  defaultValue = "headless",
  onValueChange,
  children,
}: IntegrationSwitchProps) {
  const [internal, setInternal] = useState(defaultValue);
  const options = (Object.keys(labels) as IntegrationMode[])
    .filter((mode) => views[mode] !== undefined && views[mode] !== null)
    .map((value) => ({ value, label: labels[value] }));
  const requested = value ?? internal;
  const selected = options.some((option) => option.value === requested)
    ? requested
    : "headless";
  const select = (mode: IntegrationMode) => {
    if (!options.some((option) => option.value === mode)) return;
    setInternal(mode);
    onValueChange?.(mode);
  };
  const state = { value: selected, select, options, content: views[selected] };
  if (children) return <>{children(state)}</>;
  return (
    <div data-better-stripe="integration-switch">
      <div role="group" aria-label="Integration examples">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected === option.value}
            onClick={() => select(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {state.content}
    </div>
  );
}
