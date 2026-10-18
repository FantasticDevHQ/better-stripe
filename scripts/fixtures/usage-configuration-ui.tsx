// Deterministic UI verification. No provider calls or billing resources.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  UsageConfiguration,
  UsagePriceRow,
  type UsageConfigurationValue,
} from "../../src/react/index.js";
const initial: UsageConfigurationValue = {
  plan: {
    key: "api-calls",
    version: "v2",
    model: "pay_as_you_go",
    unit: { name: "call", precision: 0 },
    rate: { currency: "usd", unitAmountDecimal: "2" },
  },
  eventName: "calls_v2",
  displayName: "API calls",
};
const meters = [
  {
    id: "mtr_original",
    active: true,
    configuration: {
      ...initial,
      plan: { ...initial.plan, version: "v1" },
      eventName: "calls_v1",
    },
  },
];
function App() {
  const [tenant, setTenant] = useState("issuer-a");
  const [failure, setFailure] = useState(false);
  const [saved, setSaved] = useState<UsageConfigurationValue | null>(null);
  return (
    <>
      <header>
        <small>BETTERSTRIPE / PACKAGE UI VERIFICATION</small>
        <h1>Native usage configuration</h1>
        <p>
          All three models. Authenticated host adapters, immutable native terms.
        </p>
        <label>
          Host account
          <select
            value={tenant}
            onChange={(event) => {
              setTenant(event.target.value);
              setSaved(null);
            }}
          >
            <option value="issuer-a">Issuer A · admin</option>
            <option value="issuer-b">Issuer B · seller</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={failure}
            onChange={(event) => setFailure(event.target.checked)}
          />{" "}
          Simulate provider error
        </label>
      </header>
      <section>
        <UsageConfiguration
          scope={{
            identityKey: tenant,
            accountKey: tenant,
            productKey: "api",
            role: tenant === "issuer-a" ? "admin" : "seller",
            ownershipLabel: tenant === "issuer-a" ? "Issuer A" : "Issuer B",
            canConfigure: true,
            capability: "issuer_native",
          }}
          initial={initial}
          meters={meters}
          onSave={async (value) => {
            if (failure) throw new Error("private-provider-reason");
            setSaved(value);
          }}
        />
      </section>
      <section>
        <h2>Submitted package contract</h2>
        <pre>
          {saved
            ? JSON.stringify(saved, null, 2)
            : "No configuration submitted."}
        </pre>
      </section>
      <section>
        <h2>Catalog price distinctions</h2>
        <UsagePriceRow
          value={{
            kind: "fixed",
            price: {
              stripePriceId: "price_fixed",
              currency: "usd",
              unitAmount: 900,
              type: "recurring",
              interval: "month",
              active: true,
            },
          }}
        />
        <UsagePriceRow value={{ kind: "unsupported", reason: "tiered" }} />
        <UsagePriceRow value={{ kind: "unsupported", reason: "transformed" }} />
      </section>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
