"use client";

import { type ReactNode, useState } from "react";

import { buildDisputeEvidence } from "../../client/connect/disputes.js";

/** The four Skool-style plain-language evidence fields (BTS-31 mapping). */
export type DisputeEvidenceFields = {
  productDescription: string;
  accessActivity: string;
  additionalInfo: string;
  customerCommunication: string;
};

/** What the app's `updateDispute` action receives from the form. */
export type EvidenceFormUpdateArgs = {
  stripeDisputeId: string;
  evidence: ReturnType<typeof buildDisputeEvidence>;
  /**
   * Always sent explicitly: `true` submits to the bank, `false` stages a
   * draft. Stripe defaults `submit` to TRUE when the key is omitted, so a
   * draft that dropped the key would be submitted — forward this as-is.
   */
  submit: boolean;
  stripeAccountId?: string;
};

export type EvidenceFormRenderProps = {
  fields: DisputeEvidenceFields;
  setField: (field: keyof DisputeEvidenceFields, value: string) => void;
  /** Save the evidence as a draft (`submit: false`). */
  stage: () => Promise<void>;
  /** Finalize the response (`submit: true`). */
  submit: () => Promise<void>;
  isProcessing: boolean;
  error: string | null;
  stageLabel: string;
  submitLabel: string;
};

export type EvidenceFormProps = {
  stripeDisputeId: string;
  /** Seller connected account the dispute lives on (Stripe-Account scoping). */
  stripeAccountId?: string;
  /**
   * App-wired action that forwards to `stripe.updateDispute` server-side. The
   * form maps its fields through `buildDisputeEvidence` before calling this.
   */
  onUpdateDispute: (args: EvidenceFormUpdateArgs) => Promise<unknown>;
  /** Pre-populate fields, e.g. from previously staged evidence. */
  initialFields?: Partial<DisputeEvidenceFields>;
  onStaged?: () => void;
  onSubmitted?: () => void;
  onError?: (message: string) => void;
  /** i18n overrides */
  stageLabel?: string;
  submitLabel?: string;
  fieldLabels?: Partial<Record<keyof DisputeEvidenceFields, string>>;
  className?: string;
  children?: (props: EvidenceFormRenderProps) => ReactNode;
};

const DEFAULT_FIELD_LABELS: Record<keyof DisputeEvidenceFields, string> = {
  productDescription: "Product description",
  accessActivity: "Access activity",
  additionalInfo: "Additional information",
  customerCommunication: "Customer communication",
};

const FIELD_ORDER = [
  "productDescription",
  "accessActivity",
  "additionalInfo",
  "customerCommunication",
] as const;

/**
 * Headless dispute evidence form (BTS-54): collects the four plain-language
 * evidence fields, maps them through the core `buildDisputeEvidence`, and
 * hands the result to the app's `updateDispute` action — staged as a draft
 * via `stage()` (`submit: false`) or finalized via `submit()` (`submit:
 * true`). The flag is always sent: Stripe submits by default when omitted.
 */
export function EvidenceForm({
  stripeDisputeId,
  stripeAccountId,
  onUpdateDispute,
  initialFields,
  onStaged,
  onSubmitted,
  onError,
  stageLabel = "Save draft",
  submitLabel = "Submit evidence",
  fieldLabels,
  className,
  children,
}: EvidenceFormProps) {
  const [fields, setFields] = useState<DisputeEvidenceFields>({
    productDescription: initialFields?.productDescription ?? "",
    accessActivity: initialFields?.accessActivity ?? "",
    additionalInfo: initialFields?.additionalInfo ?? "",
    customerCommunication: initialFields?.customerCommunication ?? "",
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (field: keyof DisputeEvidenceFields, value: string) => {
    setFields((prev) => ({ ...prev, [field]: value }));
  };

  const perform = async (submit: boolean) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setError(null);
    try {
      await onUpdateDispute({
        stripeDisputeId,
        evidence: buildDisputeEvidence(fields),
        // Explicit either way: Stripe treats an omitted `submit` as true, so
        // staging MUST send `submit: false` or "save draft" would submit.
        submit,
        ...(stripeAccountId ? { stripeAccountId } : {}),
      });
      if (submit) onSubmitted?.();
      else onStaged?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update dispute";
      setError(message);
      onError?.(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const renderProps: EvidenceFormRenderProps = {
    fields,
    setField,
    stage: () => perform(false),
    submit: () => perform(true),
    isProcessing,
    error,
    stageLabel,
    submitLabel,
  };

  if (children) {
    return <>{children(renderProps)}</>;
  }

  return (
    <div className={className}>
      {FIELD_ORDER.map((field) => (
        <label key={field}>
          {fieldLabels?.[field] ?? DEFAULT_FIELD_LABELS[field]}
          <textarea
            value={fields[field]}
            onChange={(e) => setField(field, e.target.value)}
            disabled={isProcessing}
          />
        </label>
      ))}
      {error && <div role="alert">{error}</div>}
      <button type="button" onClick={renderProps.stage} disabled={isProcessing}>
        {stageLabel}
      </button>
      <button
        type="button"
        onClick={renderProps.submit}
        disabled={isProcessing}
      >
        {submitLabel}
      </button>
    </div>
  );
}
