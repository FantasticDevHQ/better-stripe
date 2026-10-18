"use client";
import type { ReactNode } from "react";
import type { UsagePriceBinding } from "../../client/usage/catalogRead.js";
import { PriceCard, type PriceCardPrice } from "../components/PriceCard.js";
import { chargeAmountToDecimal } from "../../client/charge-currency.js";
import { formatUsageEstimate } from "./usage-format.js";
export type UsageCatalogPrice =
  | {
      kind: "fixed";
      price: PriceCardPrice & {
        usageType?: string;
        billingScheme?: string;
        transformQuantity?: unknown;
      };
    }
  | { kind: "metered"; price: UsagePriceBinding }
  | { kind: "unsupported"; reason: "tiered" | "transformed" | "other" };
export type UsagePriceRowProps = {
  value: UsageCatalogPrice;
  productName?: string;
  className?: string;
  children?: (value: UsageCatalogPrice) => ReactNode;
};
/** Read-only catalog row. Only managed metered bindings carry original exact terms. */
export function UsagePriceRow({
  value,
  className,
  productName,
  children,
}: UsagePriceRowProps) {
  if (children) return <>{children(value)}</>;
  let contents: ReactNode;
  if (value.kind === "fixed") {
    const price = value.price;
    const supported =
      price.unitAmount != null &&
      Number.isSafeInteger(price.unitAmount) &&
      price.unitAmount >= 0 &&
      chargeAmountToDecimal(price.unitAmount, price.currency) !== null &&
      price.usageType !== "metered" &&
      (!price.billingScheme || price.billingScheme === "per_unit") &&
      price.transformQuantity == null;
    contents = supported ? (
      <>
        <p>Fixed price</p>
        <PriceCard price={price}>
          {({ formattedPrice }) => <p>{formattedPrice}</p>}
        </PriceCard>
      </>
    ) : (
      <p>
        Unsupported pricing terms. Read the original provider terms before
        configuration.
      </p>
    );
  } else if (value.kind === "unsupported") {
    contents = (
      <p>
        {value.reason === "tiered"
          ? "Unsupported tiered pricing"
          : value.reason === "transformed"
            ? "Unsupported transformed pricing"
            : "Unsupported pricing terms"}
        . No fixed or zero price is inferred.
      </p>
    );
  } else {
    const { plan } = value.price;
    const amount = formatUsageEstimate(
      plan.rate.unitAmountDecimal,
      plan.rate.currency,
    );
    contents = (
      <>
        <p>
          {plan.model === "included_overage"
            ? "Included monthly units plus overages"
            : plan.model === "prepaid"
              ? "Prepaid paid credits"
              : "Pay as you go"}
        </p>
        <p>Version {plan.version}. Monthly billing, sum aggregation.</p>
        <p>
          {amount ? `${amount} per ${plan.unit.name}` : "Rate unavailable"}.
          Quantity precision {plan.unit.precision}.
        </p>
        {plan.model === "included_overage" && (
          <p>
            {plan.includedQuantity} included per billing period. Graduated free
            tier, then overages.
          </p>
        )}
        {plan.model === "prepaid" && (
          <p>
            Payment-backed issuer credits. Consumption is not a second cash
            collection.
          </p>
        )}
        <p>{value.price.active ? "Active" : "Inactive"} immutable price</p>
      </>
    );
  }
  return (
    <div className={className} data-better-stripe="usage-price-row">
      {productName && <h3>{productName}</h3>}
      {contents}
    </div>
  );
}
