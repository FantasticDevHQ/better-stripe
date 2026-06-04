"use client";

import { type ReactNode, useState } from "react";

import {
  filterPricesByInterval,
  sortPricesByAmount,
} from "../lib/price-helpers.js";
import { type BillingInterval, IntervalSelector } from "./IntervalSelector.js";
import { PriceCard, type PriceCardPrice } from "./PriceCard.js";

export type PricePickerProps = {
  prices: PriceCardPrice[];
  productName?: string;
  currentPriceId?: string;
  defaultInterval?: BillingInterval;
  onSelect?: (stripePriceId: string) => void;
  /** i18n overrides */
  monthLabel?: string;
  yearLabel?: string;
  /** Render prop for full customization */
  children?: (props: {
    interval: BillingInterval;
    setInterval: (i: BillingInterval) => void;
    filteredPrices: PriceCardPrice[];
    selectedPriceId: string | undefined;
    selectPrice: (id: string) => void;
  }) => ReactNode;
  className?: string;
};

/**
 * Headless price picker with interval toggle.
 * Combines IntervalSelector and PriceCard list.
 */
export function PricePicker({
  prices,
  productName,
  currentPriceId,
  defaultInterval = "month",
  onSelect,
  monthLabel,
  yearLabel,
  children,
  className,
}: PricePickerProps) {
  const [interval, setInterval] = useState<BillingInterval>(defaultInterval);
  const [selectedPriceId, setSelectedPriceId] = useState<string | undefined>();

  const filteredPrices = prices
    ? sortPricesByAmount(filterPricesByInterval(prices, interval))
    : [];

  const selectPrice = (id: string) => {
    setSelectedPriceId(id);
    onSelect?.(id);
  };

  if (children) {
    return (
      <>
        {children({
          interval,
          setInterval,
          filteredPrices,
          selectedPriceId,
          selectPrice,
        })}
      </>
    );
  }

  return (
    <div className={className}>
      <IntervalSelector
        value={interval}
        onChange={setInterval}
        monthLabel={monthLabel}
        yearLabel={yearLabel}
      />
      <div role="listbox">
        {filteredPrices.map((price) => (
          <PriceCard
            key={price.stripePriceId}
            price={price}
            productName={productName}
            isSelected={selectedPriceId === price.stripePriceId}
            isCurrentPlan={currentPriceId === price.stripePriceId}
            onSelect={selectPrice}
          />
        ))}
      </div>
    </div>
  );
}
