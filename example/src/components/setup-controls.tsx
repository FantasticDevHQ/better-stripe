import { ClipboardButton } from "@fantastic.dev/better-stripe/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  return (
    <ClipboardButton text={text} label={label}>
      {(state) => (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={state.isPending}
            onClick={() => void state.copy()}
          >
            {state.label}
          </Button>
          {state.error && <span role="alert">{state.error}</span>}
        </>
      )}
    </ClipboardButton>
  );
}

export function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <Badge variant={ok ? "default" : "destructive"}>
      {label ?? (ok ? "Set" : "Not set")}
    </Badge>
  );
}
