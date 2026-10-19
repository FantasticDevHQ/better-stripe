"use client";
import { useId, useState, type ReactNode } from "react";
import { useWorkflowAction } from "./useWorkflowAction.js";
import { PriceCard, type PriceCardPrice } from "../components/PriceCard.js";
export type ProductInput = { name: string; description?: string };
export type PriceInput = {
  stripeProductId: string;
  unitAmount: number;
  currency: string;
  type: "one_time" | "recurring";
  interval?: "month" | "year" | "week" | "day";
};
export type ProductActions = {
  scopeKey: string;
  createProduct?: (args: ProductInput) => Promise<unknown>;
  createPrice?: (args: PriceInput) => Promise<unknown>;
  updateProduct?: (
    args: ProductInput & { stripeProductId: string },
  ) => Promise<unknown>;
  deactivateProduct?: (args: { stripeProductId: string }) => Promise<unknown>;
  deactivatePrice?: (args: { stripePriceId: string }) => Promise<unknown>;
};
export type ProductEdit = {
  stripeProductId: string;
  name: string;
  description: string;
};
export function useProductManager(props: ProductActions) {
  const initial = {
    scope: props.scopeKey,
    expandedProduct: null as string | null,
    showCreateDialog: false,
    showAddPriceFor: null as string | null,
    newProduct: { name: "", description: "" },
    newPrice: { amount: "", currency: "usd", interval: "month" },
    editingProduct: null as ProductEdit | null,
  };
  const [fields, setFields] = useState(initial);
  if (fields.scope !== props.scopeKey) setFields(initial);
  type Command = {
    type: "create" | "price" | "edit" | "archiveProduct" | "archivePrice";
    id?: string;
  };
  const [command, setCommand] = useState<Command | null>(null);
  const action = useWorkflowAction(async (command: Command) => {
    setCommand(command);
    switch (command.type) {
      case "create": {
        if (!props.createProduct)
          throw new Error("Product creation is not configured.");
        if (!fields.newProduct.name.trim())
          throw new Error("Enter a product name.");
        await props.createProduct({
          name: fields.newProduct.name.trim(),
          description: fields.newProduct.description.trim() || undefined,
        });
        break;
      }
      case "price": {
        if (!props.createPrice)
          throw new Error("Price creation is not configured.");
        const unitAmount = Number(fields.newPrice.amount);
        if (
          !/^\d+$/.test(fields.newPrice.amount) ||
          !Number.isSafeInteger(unitAmount) ||
          unitAmount <= 0
        )
          throw new Error("Enter a positive integer price in minor units.");
        if (!/^[a-zA-Z]{3}$/.test(fields.newPrice.currency))
          throw new Error("Enter a three-letter currency code.");
        const interval = fields.newPrice.interval;
        if (!["one_time", "month", "year", "week", "day"].includes(interval))
          throw new Error("Choose a supported price interval.");
        await props.createPrice({
          stripeProductId: command.id!,
          unitAmount,
          currency: fields.newPrice.currency.toLowerCase(),
          type: interval === "one_time" ? "one_time" : "recurring",
          interval:
            interval === "one_time"
              ? undefined
              : (interval as PriceInput["interval"]),
        });
        break;
      }
      case "edit": {
        if (!props.updateProduct || !fields.editingProduct)
          throw new Error("Product editing is not configured.");
        if (!fields.editingProduct.name.trim())
          throw new Error("Enter a product name.");
        await props.updateProduct({
          stripeProductId: fields.editingProduct.stripeProductId,
          name: fields.editingProduct.name.trim(),
          description: fields.editingProduct.description.trim() || undefined,
        });
        break;
      }
      case "archiveProduct":
        if (!props.deactivateProduct)
          throw new Error("Product archiving is not configured.");
        else await props.deactivateProduct({ stripeProductId: command.id! });
        break;
      case "archivePrice":
        if (!props.deactivatePrice)
          throw new Error("Price archiving is not configured.");
        else await props.deactivatePrice({ stripePriceId: command.id! });
        break;
    }
    return true;
  }, props.scopeKey);
  const run = action.run;
  const set = <K extends keyof typeof initial>(
    key: K,
    value: (typeof initial)[K],
  ) => setFields((previous) => ({ ...previous, [key]: value }));
  return {
    ...fields,
    error: action.error,
    clearError: action.reset,
    isPending: action.isPending,
    isCreatingProduct: action.isPending && command?.type === "create",
    isCreatingPrice: action.isPending && command?.type === "price",
    isSavingEdit: action.isPending && command?.type === "edit",
    deactivatingId:
      action.isPending && command?.type === "archiveProduct"
        ? command.id
        : null,
    deactivatingPriceId:
      action.isPending && command?.type === "archivePrice" ? command.id : null,
    setExpandedProduct: (value: string | null) => set("expandedProduct", value),
    setShowCreateDialog: (value: boolean) => set("showCreateDialog", value),
    setShowAddPriceFor: (value: string | null) => set("showAddPriceFor", value),
    setNewProduct: (value: typeof initial.newProduct) =>
      set("newProduct", value),
    setNewPrice: (value: typeof initial.newPrice) => set("newPrice", value),
    setEditingProduct: (value: ProductEdit | null) =>
      set("editingProduct", value),
    handleCreateProduct: async () => {
      if (await run({ type: "create" }))
        setFields((previous) => ({
          ...previous,
          newProduct: initial.newProduct,
          showCreateDialog: false,
        }));
    },
    handleAddPrice: async (id: string) => {
      if (await run({ type: "price", id }))
        setFields((previous) => ({
          ...previous,
          newPrice: initial.newPrice,
          showAddPriceFor: null,
        }));
    },
    handleSaveEdit: async () => {
      if (await run({ type: "edit" })) set("editingProduct", null);
    },
    handleDeactivate: (id: string) => run({ type: "archiveProduct", id }),
    handleDeactivatePrice: (id: string) => run({ type: "archivePrice", id }),
  };
}
export type CatalogProduct = {
  stripeProductId: string;
  name: string;
  description?: string;
  active: boolean;
  prices: PriceCardPrice[];
};
export type ProductsRenderProps = ReturnType<typeof useProductManager> & {
  products: CatalogProduct[];
  isLoading: boolean;
};
export type ProductsProps = ProductActions & {
  products: CatalogProduct[] | undefined;
  children?: (state: ProductsRenderProps) => ReactNode;
};
/** Complete catalog creation/editing/archiving controller, with optional custom rendering. Amount inputs use minor units. */
export function Products(props: ProductsProps) {
  return <ProductsBody key={props.scopeKey} {...props} />;
}
function ProductsBody(props: ProductsProps) {
  const state = useProductManager(props);
  const id = useId();
  const result = {
    ...state,
    products: props.products ?? [],
    isLoading: props.products === undefined,
  };
  if (props.children) return <>{props.children(result)}</>;
  return (
    <section data-better-stripe="products" aria-busy={state.isPending}>
      <h2>Products</h2>
      {state.error && <p role="alert">{state.error}</p>}
      {props.createProduct && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void state.handleCreateProduct();
          }}
        >
          <label htmlFor={`${id}-name`}>Product name</label>
          <input
            id={`${id}-name`}
            required
            value={state.newProduct.name}
            onChange={(event) =>
              state.setNewProduct({
                ...state.newProduct,
                name: event.target.value,
              })
            }
          />
          <label htmlFor={`${id}-description`}>Description</label>
          <input
            id={`${id}-description`}
            value={state.newProduct.description}
            onChange={(event) =>
              state.setNewProduct({
                ...state.newProduct,
                description: event.target.value,
              })
            }
          />
          <button type="submit" disabled={state.isPending}>
            {state.isCreatingProduct ? "Creating…" : "Create product"}
          </button>
        </form>
      )}
      {result.isLoading ? (
        <p role="status">Loading products…</p>
      ) : !result.products.length ? (
        <p>No products yet.</p>
      ) : (
        result.products.map((product) => (
          <article key={product.stripeProductId}>
            <h3>{product.name}</h3>
            <p>{product.description}</p>
            {product.prices.map((price) => (
              <div key={price.stripePriceId}>
                <PriceCard price={price}>
                  {({ formattedPrice }) => <p>{formattedPrice}</p>}
                </PriceCard>
                {props.deactivatePrice && price.active && (
                  <button
                    type="button"
                    disabled={state.isPending}
                    onClick={() => {
                      void state.handleDeactivatePrice(price.stripePriceId);
                    }}
                  >
                    Archive price
                  </button>
                )}
              </div>
            ))}
            {props.createPrice && (
              <button
                type="button"
                disabled={state.isPending}
                onClick={() =>
                  state.setShowAddPriceFor(product.stripeProductId)
                }
              >
                Add price
              </button>
            )}
            {props.updateProduct && (
              <button
                type="button"
                onClick={() =>
                  state.setEditingProduct({
                    stripeProductId: product.stripeProductId,
                    name: product.name,
                    description: product.description ?? "",
                  })
                }
              >
                Edit product
              </button>
            )}
            {props.deactivateProduct && (
              <button
                type="button"
                disabled={state.isPending}
                onClick={() => {
                  void state.handleDeactivate(product.stripeProductId);
                }}
              >
                Archive product
              </button>
            )}
          </article>
        ))
      )}
      {props.createPrice && state.showAddPriceFor && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void state.handleAddPrice(state.showAddPriceFor!);
          }}
        >
          <label htmlFor={`${id}-amount`}>Price in minor units</label>
          <input
            id={`${id}-amount`}
            type="number"
            required
            min="1"
            step="1"
            value={state.newPrice.amount}
            onChange={(event) =>
              state.setNewPrice({
                ...state.newPrice,
                amount: event.target.value,
              })
            }
          />
          <label htmlFor={`${id}-currency`}>Currency</label>
          <input
            id={`${id}-currency`}
            required
            minLength={3}
            maxLength={3}
            value={state.newPrice.currency}
            onChange={(event) =>
              state.setNewPrice({
                ...state.newPrice,
                currency: event.target.value,
              })
            }
          />
          <label htmlFor={`${id}-interval`}>Interval</label>
          <select
            id={`${id}-interval`}
            value={state.newPrice.interval}
            onChange={(event) =>
              state.setNewPrice({
                ...state.newPrice,
                interval: event.target.value,
              })
            }
          >
            {["one_time", "month", "year", "week", "day"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <button type="submit" disabled={state.isPending}>
            {state.isCreatingPrice ? "Creating…" : "Create price"}
          </button>
        </form>
      )}
      {state.editingProduct && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void state.handleSaveEdit();
          }}
        >
          <label htmlFor={`${id}-edit-name`}>Product name</label>
          <input
            id={`${id}-edit-name`}
            required
            value={state.editingProduct.name}
            onChange={(event) =>
              state.setEditingProduct({
                ...state.editingProduct!,
                name: event.target.value,
              })
            }
          />
          <label htmlFor={`${id}-edit-description`}>Description</label>
          <input
            id={`${id}-edit-description`}
            value={state.editingProduct.description}
            onChange={(event) =>
              state.setEditingProduct({
                ...state.editingProduct!,
                description: event.target.value,
              })
            }
          />
          <button type="submit" disabled={state.isPending}>
            {state.isSavingEdit ? "Saving…" : "Save product"}
          </button>
        </form>
      )}
    </section>
  );
}
