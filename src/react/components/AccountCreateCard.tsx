'use client';

import { type ReactNode, useState } from 'react';

export type AccountCreateCountry = {
  id: string;
  name: string;
  icon?: string;
  [key: string]: unknown;
};

export type AccountCreateCardRenderProps = {
  onCreate: (args: { email?: string; country?: string }) => void;
  isCreating: boolean;
  selectedCountry: string;
  setSelectedCountry: (country: string) => void;
  countries: AccountCreateCountry[];
};

export type AccountCreateCardProps = {
  onCreate?: (args: { email?: string; country?: string }) => void;
  isCreating?: boolean;
  countries?: AccountCreateCountry[];
  titleLabel?: string;
  descriptionLabel?: string;
  createLabel?: string;
  creatingLabel?: string;
  className?: string;
  /** Render prop for custom country selector UI */
  renderCountrySelector?: (props: {
    selectedCountry: string;
    onSelect: (country: string) => void;
    countries: AccountCreateCountry[];
  }) => ReactNode;
  /** Render prop for custom benefits/info section */
  renderBenefits?: () => ReactNode;
  /** Full render prop — overrides all default rendering */
  children?: (props: AccountCreateCardRenderProps) => ReactNode;
};

/**
 * Headless Stripe Connect account creation card.
 * Apps provide the actual creation logic via onCreate.
 */
export function AccountCreateCard({
  onCreate,
  isCreating = false,
  countries = [],
  titleLabel = 'Set up payments',
  descriptionLabel = 'Connect a Stripe account to start accepting payments.',
  createLabel = 'Get started',
  creatingLabel = 'Creating…',
  className,
  renderCountrySelector,
  renderBenefits,
  children,
}: AccountCreateCardProps) {
  const [selectedCountry, setSelectedCountry] = useState('');

  const handleCreate = (args: { email?: string; country?: string } = {}) => {
    onCreate?.({ ...args, country: args.country ?? selectedCountry });
  };

  if (children) {
    return (
      <>
        {children({
          onCreate: handleCreate,
          isCreating,
          selectedCountry,
          setSelectedCountry,
          countries,
        })}
      </>
    );
  }

  return (
    <div className={className} data-slot="account-create-card">
      <div data-slot="account-create-card-header">
        <h3 data-slot="account-create-card-title">{titleLabel}</h3>
        <p data-slot="account-create-card-description">{descriptionLabel}</p>
      </div>
      <div data-slot="account-create-card-content">
        {renderBenefits?.()}
        {renderCountrySelector ? (
          renderCountrySelector({
            selectedCountry,
            onSelect: setSelectedCountry,
            countries,
          })
        ) : countries.length > 0 ? (
          <select
            data-slot="account-create-card-country-select"
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value)}
          >
            <option value="">Select a country…</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div data-slot="account-create-card-footer">
        <button
          type="button"
          data-slot="account-create-card-button"
          onClick={() => handleCreate()}
          disabled={isCreating || (!selectedCountry && countries.length > 0)}
        >
          {isCreating ? creatingLabel : createLabel}
        </button>
      </div>
    </div>
  );
}
