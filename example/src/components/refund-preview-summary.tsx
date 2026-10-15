import {
  formatRefundAmount,
  type RefundPreviewGroup,
} from "@fantastic.dev/better-stripe/react";

const labels = new Map([
  ["succeeded", "Succeeded refunds"],
  ["pending", "Pending requests"],
  ["failed", "Failed requests"],
  ["canceled", "Canceled requests"],
  ["requires_action", "Requests requiring action"],
]);

export function RefundPreviewSummary({
  groups,
  isLoading,
}: {
  groups: RefundPreviewGroup[];
  isLoading: boolean;
}) {
  if (isLoading)
    return (
      <p className="text-muted-foreground text-sm">Loading refund amounts...</p>
    );
  if (groups.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        No refund amounts in this preview
      </p>
    );
  return (
    <dl
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="refund-preview-groups"
    >
      {groups.map((group) => (
        <div
          className="space-y-1"
          key={JSON.stringify([group.currency, group.status])}
        >
          <dt className="text-muted-foreground text-xs uppercase tracking-wide">{`${labels.get(group.status) ?? `Requests: ${group.status}`} (${group.currency.toUpperCase()})`}</dt>
          <dd
            className="text-lg font-semibold"
            data-testid={`refund-preview-${group.status}-${group.currency}`}
          >
            {(group.amount === null
              ? null
              : formatRefundAmount(group.amount, group.currency)) ??
              "Amount unavailable"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
