"use client";
import { useId } from "react";
import { useUsageConfiguration } from "./useUsageConfiguration.js";
import type {
  UsageConfigurationFields,
  UsageConfigurationProps,
} from "./UsageConfiguration.types.js";
/** Unstyled native catalog configuration. Host adapters own authorization and provider operations. */
export function UsageConfiguration(props: UsageConfigurationProps) {
  const id = useId();
  const state = useUsageConfiguration(props);
  if (props.children) return <>{props.children(state)}</>;
  if (props.scope.capability !== "issuer_native")
    return (
      <p role="status">
        Native usage configuration unavailable for this account.
      </p>
    );
  const input = (
    field: keyof UsageConfigurationFields,
    label: string,
    inputMode?: "decimal" | "numeric",
  ) => (
    <label htmlFor={`${id}-${field}`}>
      {label}
      <input
        id={`${id}-${field}`}
        value={state.fields[field]}
        inputMode={inputMode}
        disabled={state.immutable}
        onChange={(event) => state.setField(field, event.target.value)}
      />
    </label>
  );
  return (
    <form
      className={props.className}
      data-better-stripe="usage-configuration"
      aria-label="Usage configuration"
      aria-busy={state.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        void state.save();
      }}
    >
      <h3>Usage configuration</h3>
      <p>
        Owner: {props.scope.ownershipLabel}. Authorized {props.scope.role}{" "}
        configuration.
      </p>
      <p>
        Monthly billing with sum aggregation. Existing subscriptions keep their
        original prices. Changed terms require a new version, event name and
        price.
      </p>
      <fieldset disabled={state.disabled || state.isPending}>
        <legend>Meter and immutable billing terms</legend>
        <label htmlFor={`${id}-meter`}>Meter</label>
        <select
          id={`${id}-meter`}
          value={state.meterId}
          onChange={(event) => state.selectMeter(event.target.value)}
        >
          <option value="">Create new meter version</option>
          {props.meters.map((meter) => (
            <option key={meter.id} value={meter.id} disabled={!meter.active}>
              {meter.configuration.displayName} ·{" "}
              {meter.configuration.plan.version}
              {meter.active ? "" : " (inactive)"}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-model`}>Billing model</label>
        <select
          id={`${id}-model`}
          value={state.fields.model}
          disabled={state.immutable}
          onChange={(event) =>
            state.setField(
              "model",
              event.target.value as UsageConfigurationFields["model"],
            )
          }
        >
          <option value="pay_as_you_go">Pay as you go</option>
          <option value="included_overage">
            Included monthly units plus overages
          </option>
          <option value="prepaid">Prepaid paid credits</option>
        </select>
        {input("key", "Plan key")}
        {input("version", "Plan version")}
        {input("eventName", "Meter event name")}
        {input("displayName", "Meter display name")}
        {input("unit", "Billable unit")}
        {input("precision", "Quantity precision", "numeric")}
        {input("currency", "Currency")}
        {input(
          "price",
          `Price per whole unit (${state.fields.currency.toUpperCase()})`,
          "decimal",
        )}
        {state.fields.model === "included_overage" && (
          <>
            {input("included", "Included units per billing period", "decimal")}
            <p>
              Graduated pricing: free included units, then the configured
              overage rate. Reset at each original monthly billing period.
            </p>
          </>
        )}
        {state.fields.model === "prepaid" && (
          <>
            {input("packageQuantity", "Credit package quantity", "decimal")}
            <p>
              Manual top-up with a verified payment for the issuer's own
              services. Retain original credit terms. Reject work when credits
              are insufficient. No automatic top-up or monetary wallet.
            </p>
          </>
        )}
        <p>
          Only managed monthly sum meters and exact per-unit rates or
          included-unit graduated tiers are supported. Other tiers,
          transformations and intervals require a supported server adapter.
        </p>
        <button type="submit">
          {state.isPending ? "Saving…" : "Save configuration version"}
        </button>
      </fieldset>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
