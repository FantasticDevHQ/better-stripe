"use client";

export type BillingInterval = "month" | "year";

export type IntervalSelectorProps = {
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
  monthLabel?: string;
  yearLabel?: string;
  className?: string;
  /** Render prop for full customization */
  children?: (props: {
    value: BillingInterval;
    setMonth: () => void;
    setYear: () => void;
  }) => React.ReactNode;
};

/**
 * Headless billing interval toggle (month/year).
 * Use the render prop for full UI customization.
 */
export function IntervalSelector({
  value,
  onChange,
  monthLabel = "Monthly",
  yearLabel = "Yearly",
  className,
  children,
}: IntervalSelectorProps) {
  const setMonth = () => onChange("month");
  const setYear = () => onChange("year");

  if (children) {
    return <>{children({ value, setMonth, setYear })}</>;
  }

  return (
    <div className={className} role="radiogroup" aria-label="Billing interval">
      <button
        type="button"
        role="radio"
        aria-checked={value === "month"}
        onClick={setMonth}
      >
        {monthLabel}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "year"}
        onClick={setYear}
      >
        {yearLabel}
      </button>
    </div>
  );
}
