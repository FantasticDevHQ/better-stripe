import type { CheckoutFormState } from "@fantastic.dev/better-stripe/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
/** The example's design system. Validation and confirmation belong to BetterStripe. */
export function CheckoutFormFields(state: CheckoutFormState) {
  return (
    <form
      className="space-y-5"
      onSubmit={state.submit}
      aria-busy={state.isPending}
    >
      <div className="space-y-2">
        <Label htmlFor={state.emailInputId}>Email for your receipt</Label>
        <Input
          id={state.emailInputId}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={state.email}
          readOnly={state.emailReadOnly}
          onChange={(event) => state.setEmail(event.target.value)}
        />
      </div>
      {state.paymentElement}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={state.isPending}>
        {state.isPending ? "Processing…" : "Pay"}
      </Button>
    </form>
  );
}
