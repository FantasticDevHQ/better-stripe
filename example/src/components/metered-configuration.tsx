import { useId } from "react";
import {
  UsageConfiguration,
  type UsageConfigurationProps,
  type UsageConfigurationFields,
} from "@fantastic.dev/better-stripe/react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
/** Styling adapter only. All field validation and immutable/submission state stays in the package. */
export function MeteredConfiguration(props: UsageConfigurationProps) {
  const id = useId();
  return (
    <UsageConfiguration {...props}>
      {(state) => {
        const field = (
          key: keyof UsageConfigurationFields,
          label: string,
          inputMode?: "decimal" | "numeric",
        ) => (
          <div className="space-y-2">
            <Label htmlFor={`${id}-${key}`}>{label}</Label>
            <Input
              required={true}
              id={`${id}-${key}`}
              value={state.fields[key]}
              inputMode={inputMode}
              onChange={(event) => state.setField(key, event.target.value)}
            />
          </div>
        );
        return (
          <form
            aria-label="Usage configuration"
            onSubmit={(event) => {
              event.preventDefault();
              if (event.currentTarget.reportValidity()) void state.save();
            }}
          >
            <fieldset
              disabled={state.disabled || state.isPending}
              className="space-y-4"
            >
              <legend className="mb-4 text-sm text-muted-foreground">
                Monthly interval · sum aggregation · immutable version{" "}
                {state.fields.version}
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {field("unit", "Billable unit")}
                {field("precision", "Quantity precision", "numeric")}
                {field("currency", "Currency")}
                {field(
                  "price",
                  `Price per whole unit (${state.fields.currency.toUpperCase()})`,
                  "decimal",
                )}
                {field("version", "Plan version")}
              </div>
              {state.fields.model === "included_overage" &&
                field(
                  "included",
                  "Included units per billing period",
                  "decimal",
                )}
              {state.fields.model === "prepaid" && (
                <>
                  {field(
                    "packageQuantity",
                    "Credit package quantity",
                    "decimal",
                  )}
                  <p className="text-sm text-muted-foreground">
                    Manual top-up with verified issuer-service payments. Work
                    stops when credits are insufficient.
                  </p>
                </>
              )}
              <Button type="submit">
                {state.isPending ? "Saving…" : "Save and set up"}
              </Button>
            </fieldset>
            {state.error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {state.error}
              </p>
            )}
            {state.message && (
              <p role="status" className="mt-3 text-sm">
                {state.message}
              </p>
            )}
          </form>
        );
      }}
    </UsageConfiguration>
  );
}
