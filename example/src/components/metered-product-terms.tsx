import { UsagePriceRow } from "@fantastic.dev/better-stripe/react";
import type { Doc } from "../../convex/_generated/dataModel";
import type { ProductProvider } from "../../convex/meteredProducts/native";
import { money } from "@/lib/metered-money";
export function SavedOffer({ offer }: { offer: Doc<"meteredProductOffers"> }) {
  const provider = JSON.parse(offer.providerJson!) as ProductProvider;
  return (
    <div className="space-y-3">
      <p className="text-lg font-medium">
        {offer.baseAmount > 0
          ? `${money(offer.baseAmount, provider.price.currency)} / month + usage`
          : provider.configuration.plan.model === "prepaid"
            ? "Manual prepaid credits"
            : "Usage billed monthly"}
      </p>
      <UsagePriceRow value={{ kind: "metered", price: provider.price }} />
      <p className="text-sm text-muted-foreground">
        Billing is attached to {offer.productName}. Existing subscribers retain
        these terms.
      </p>
    </div>
  );
}
