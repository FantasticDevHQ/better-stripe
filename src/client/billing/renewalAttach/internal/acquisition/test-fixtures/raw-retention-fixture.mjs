// Declared synthetic raw data only. No SDK/test-runner/TypeScript/W imports or calls.
import { configurationInput } from "./fixture.mjs";
export const own = (body, key, value) =>
  Object.defineProperty(body, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
export const at = (root, path) => path.reduce((v, k) => v[k], root);
export const parsedPaths = [
  ["subscription"],
  ["subscription", "items"],
  ["subscription", "items", "data", 0],
  ["subscription", "items", "data", 0, "price"],
  ["subscription", "items", "data", 0, "price", "recurring"],
  ["subscription", "items", "data", 0, "price", "product"],
  ["targetPrice"],
  ["targetPrice", "recurring"],
  ["targetPrice", "product"],
  ["billingCustomer"],
  ["billingCustomer", "discount"],
];
export function rawRetentionInput() {
  return structuredClone(configurationInput().preparation);
}
export function expandedRawRetentionInput() {
  const p = rawRetentionInput();
  p.subscription.items.data[0].price.product = {
    id: p.expected.currentProductId,
    object: "product",
    deleted: false,
  };
  p.targetPrice.product = {
    id: p.expected.targetProductId,
    object: "product",
    deleted: false,
  };
  p.billingCustomer.discount = {
    id: "di_customer",
    object: "discount",
    deleted: false,
  };
  return p;
}
export function rawRetentionConfiguration(preparation = rawRetentionInput()) {
  const c = configurationInput();
  c.preparation = structuredClone(preparation);
  c.attachReceipt.attachRequest.preparation = structuredClone(preparation);
  c.freshSubscription = {
    ...structuredClone(preparation.subscription),
    schedule: c.schedule.id,
  };
  c.targetPrice = structuredClone(preparation.targetPrice);
  c.billingCustomer = structuredClone(preparation.billingCustomer);
  return c;
}
export const normalPreFixFullSHA = {
  legacy: "ed0e7fe3641e216caf66fd225b1a7366a4a3ab7f2825448ec9fbbf697621e150",
  prepared: "4c27c7f4c0f4743d6a5ff3c76da42c024c4f2e29f6bc65b4ad29bb21dfdbc8d3",
  receipt: "dd79636e1248efc8efad99737bcd156d322f3078aea7ecebf007f0d1d953b01c",
  configuration:
    "ef08ad09044c32eaa3152b3a7fe058a68f77edf704c3176ada86cd5c5c6179d8",
};
