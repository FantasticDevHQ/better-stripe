import { Link } from "react-router-dom";
export function ProductBillingLink({
  productId,
  description,
}: {
  productId: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{description ?? ""}</p>
      <Link
        className="text-sm text-primary underline"
        to={`/demo/metered-usage?product=${encodeURIComponent(productId)}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        Configure metered billing
      </Link>
    </div>
  );
}
