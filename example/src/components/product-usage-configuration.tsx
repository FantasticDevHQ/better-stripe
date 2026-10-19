import { useId } from "react";
import {
  UsageConfiguration,
  useUsageConfiguration,
  type UsageConfigurationProps,
  type UsageConfigurationState,
  type UsageConfigurationFields,
} from "@fantastic.dev/better-stripe/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
type Props = UsageConfigurationProps & {
  base: string;
  setBase: (value: string) => void;
};
/** The headless example supplies its own form; the component example delegates lifecycle to UsageConfiguration. */
export function HeadlessProductConfiguration(props: Props) {
  const state = useUsageConfiguration(props);
  return (
    <ProductFields state={state} base={props.base} setBase={props.setBase} />
  );
}
export function ComponentProductConfiguration(props: Props) {
  return (
    <UsageConfiguration {...props}>
      {(state) => (
        <ProductFields
          state={state}
          base={props.base}
          setBase={props.setBase}
        />
      )}
    </UsageConfiguration>
  );
}
function ProductFields({
  state,
  base,
  setBase,
}: {
  state: UsageConfigurationState;
  base: string;
  setBase: Props["setBase"];
}) {
  const id = useId();
  const disabled = state.disabled || state.immutable || state.isPending;
  const field = (
    key: keyof UsageConfigurationFields,
    label: string,
    numeric = false,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Input
        id={`${id}-${key}`}
        value={state.fields[key]}
        inputMode={numeric ? "decimal" : "text"}
        pattern={numeric ? "(0|[1-9][0-9]*)([.][0-9]{1,2})?" : undefined}
        required={true}
        onChange={(event) => state.setField(key, event.target.value)}
      />
    </div>
  );
  return (
    <form
      aria-label="Product metered billing"
      onSubmit={(event) => {
        event.preventDefault();
        if (event.currentTarget.reportValidity()) void state.save();
      }}
      className="space-y-4"
    >
      <fieldset
        aria-label="Product billing terms"
        disabled={disabled}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {state.fields.model !== "prepaid" && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-base`}>Monthly base price (USD)</Label>
              <Input
                id={`${id}-base`}
                inputMode="decimal"
                pattern="(0|[1-9][0-9]*)([.][0-9]{1,2})?"
                required={true}
                value={base}
                onChange={(event) => setBase(event.target.value)}
              />
            </div>
          )}
          {field("unit", "Billable unit")}
          {field(
            "price",
            state.fields.model === "included_overage"
              ? "Overage price per unit (USD)"
              : "Price per unit (USD)",
            true,
          )}
          {state.fields.model === "included_overage" &&
            field("included", "Included units per billing period", true)}
          {state.fields.model === "prepaid" &&
            field("packageQuantity", "Credit package quantity", true)}
        </div>
        <p className="text-sm text-muted-foreground">
          {state.fields.model === "prepaid"
            ? "Manual credit purchases for the platform's own report service. Work stops when credits run out."
            : `The monthly base fee and usage price attach to this product on one subscription. ${state.fields.model === "included_overage" ? `The first ${state.fields.included} ${state.fields.unit}s are included each billing period.` : "Usage is billed at the end of each billing period."}`}
        </p>
        <Button
          type="submit"
          disabled={state.disabled || state.immutable || state.isPending}
        >
          {state.disabled
            ? "Billing attached"
            : state.isPending
              ? "Attaching…"
              : "Attach billing to product"}
        </Button>
      </fieldset>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}
