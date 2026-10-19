// Local visual fixture: actual public workflow, simulated catalog and callbacks.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Products, type CatalogProduct } from "../../src/react/index.js";

const original: CatalogProduct = {
  stripeProductId: "prod_fixture_existing",
  name: "Existing membership",
  description: "An existing catalog with edit and archive capabilities only.",
  active: true,
  prices: [
    {
      stripePriceId: "price_fixture_monthly",
      unitAmount: 1500,
      currency: "usd",
      type: "recurring",
      interval: "month",
      active: true,
    },
  ],
};

/** Keep synthetic catalog feedback synchronized with the real workflow callbacks. */
function App() {
  const [products, setProducts] = useState([original]);
  const [result, setResult] = useState("No callback invoked");
  const product = products[0]!;
  return (
    <>
      <header>
        <small>BETTERSTRIPE / PACKAGE UI VERIFICATION</small>
        <h1>Edit an existing catalog</h1>
        <p className="disclosure" role="note">
          Synthetic catalog and simulated authorized callbacks. No
          authentication, network requests, Stripe operations or payments are
          performed.
        </p>
        <p>
          This is the exported Products default UI. Product and price creation
          callbacks are intentionally absent; editing and archiving remain
          available.
        </p>
      </header>
      <Products
        scopeKey="synthetic-products-editor"
        products={products}
        updateProduct={async ({ stripeProductId, name, description }) => {
          if (stripeProductId !== original.stripeProductId)
            throw new Error("Unknown synthetic product");
          setProducts((rows) =>
            rows.map((row) => ({ ...row, name, description })),
          );
          setResult(`updateProduct: ${stripeProductId} → ${name}`);
        }}
        deactivateProduct={async ({ stripeProductId }) => {
          if (stripeProductId !== original.stripeProductId)
            throw new Error("Unknown synthetic product");
          setProducts((rows) => rows.map((row) => ({ ...row, active: false })));
          setResult(`deactivateProduct: ${stripeProductId} → active=false`);
        }}
      />
      <section aria-labelledby="result-heading">
        <h2 id="result-heading">Simulated host feedback</h2>
        <div className="facts">
          <p data-testid="catalog-name">Name: {product.name}</p>
          <p data-testid="catalog-status">
            Catalog status: {product.active ? "Active" : "Archived"}
          </p>
        </div>
        <output aria-live="polite" data-testid="callback-result">
          {result}
        </output>
      </section>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
