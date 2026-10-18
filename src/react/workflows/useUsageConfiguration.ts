"use client";
import { useState } from "react";
import { defineUsagePlan } from "../../client/usage/contracts.js";
import { useWorkflowAction } from "./useWorkflowAction.js";
import {
  configurationFields,
  validateConfiguration,
} from "./usage-configuration-validation.js";
import type {
  UsageConfigurationProps,
  UsageConfigurationState,
} from "./UsageConfiguration.types.js";
/** Shared form lifecycle for component and HTTP adapters. Server authorization is mandatory. */
export function useUsageConfiguration(
  props: UsageConfigurationProps,
): UsageConfigurationState {
  const key = JSON.stringify([props.scope, props.initial, props.meters]);
  const initial = {
    key,
    meterId: props.initial.meterId ?? "",
    fields: configurationFields(props.initial),
  };
  const [state, setState] = useState(initial);
  if (state.key !== key) setState(initial);
  const disabled =
    !props.scope.canConfigure || props.scope.capability !== "issuer_native";
  const immutable = state.meterId !== "";
  const action = useWorkflowAction(async () => {
    if (disabled) throw new Error("Configuration is read-only for this scope.");
    let value = validateConfiguration(state.fields, state.meterId);
    if (immutable) {
      const meter = props.meters.find((item) => item.id === state.meterId);
      if (
        !meter?.active ||
        JSON.stringify(
          validateConfiguration(
            configurationFields(meter.configuration),
            meter.id,
          ),
        ) !== JSON.stringify(value)
      )
        throw new Error(
          "Select an active managed meter with unchanged original terms.",
        );
      // Native intent fingerprints retain the original lexical decimal snapshot.
      value = {
        ...value,
        plan: defineUsagePlan(meter.configuration.plan),
        ...(value.creditPackage
          ? {
              creditPackage: {
                ...value.creditPackage,
                quantity:
                  meter.configuration.creditPackage?.quantity ??
                  value.creditPackage.quantity,
              },
            }
          : {}),
      };
    }
    try {
      await props.onSave(value);
    } catch {
      throw new Error(
        "Configuration could not be saved. Retry the same terms or ask an administrator to reconcile the operation.",
      );
    }
    return "Configuration version saved. Existing subscriptions keep their original prices.";
  }, key);
  return {
    fields: state.fields,
    meterId: state.meterId,
    immutable,
    disabled,
    isPending: action.isPending,
    error: action.error,
    message: action.result,
    save: action.run,
    setField: (field, value) => {
      if (disabled || immutable || action.isPending) return;
      action.reset();
      setState((current) => ({
        ...current,
        fields: { ...current.fields, [field]: value },
      }));
    },
    selectMeter: (meterId) => {
      if (disabled || action.isPending) return;
      const meter = props.meters.find((item) => item.id === meterId);
      if (meterId && !meter?.active) return;
      action.reset();
      setState({
        key,
        meterId,
        fields: configurationFields(meter?.configuration ?? props.initial),
      });
    },
  };
}
