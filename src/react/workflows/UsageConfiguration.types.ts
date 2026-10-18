import type { ReactNode } from "react";
import type {
  UsagePlan,
  UsageBillingModel,
} from "../../client/usage/contracts.js";
/** Display/cache context from an authenticated host. Never use this as server authorization. */
export type UsageConfigurationScope = {
  identityKey: string;
  accountKey: string;
  productKey: string;
  role: "admin" | "seller";
  ownershipLabel: string;
  canConfigure: boolean;
  /** Host has verified the configured issuer realm and supported native catalog. */
  capability: "issuer_native" | "unsupported";
};
export type UsageConfigurationValue = {
  plan: UsagePlan;
  eventName: string;
  displayName: string;
  meterId?: string;
  creditPackage?: { quantity: string; topUp: "manual" };
};
export type UsageMeterChoice = {
  id: string;
  active: boolean;
  /** Original managed terms, derived and authorized by the host. */
  configuration: UsageConfigurationValue;
};
export type UsageConfigurationFields = {
  model: UsageBillingModel;
  key: string;
  version: string;
  unit: string;
  precision: string;
  currency: string;
  price: string;
  included: string;
  packageQuantity: string;
  eventName: string;
  displayName: string;
};
export type UsageConfigurationProps = {
  scope: UsageConfigurationScope;
  initial: UsageConfigurationValue;
  /** A scoped page/subset of managed meters. Never treat a partial list as complete inventory. */
  meters: readonly UsageMeterChoice[];
  /** Reauthorize, derive ownership/product/realm and validate immutable terms on the server. */
  onSave: (value: UsageConfigurationValue) => Promise<unknown>;
  className?: string;
  children?: (state: UsageConfigurationState) => ReactNode;
};
export type UsageConfigurationState = {
  fields: UsageConfigurationFields;
  setField: <K extends keyof UsageConfigurationFields>(
    key: K,
    value: UsageConfigurationFields[K],
  ) => void;
  meterId: string;
  selectMeter: (id: string) => void;
  immutable: boolean;
  disabled: boolean;
  isPending: boolean;
  error: string | null;
  message: string | undefined;
  save: () => Promise<unknown>;
};
