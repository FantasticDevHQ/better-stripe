export function line() {
  return {
    id: "il_SYNTHETIC",
    object: "line_item",
    amount: 900,
    currency: "usd",
    discount_amounts: [{ discount: "di_ITEM", amount: 100 }],
    discountable: true,
    discounts: ["di_SUB", "di_ITEM"],
    invoice: "in_SYNTHETIC",
    livemode: false,
    parent: {
      type: "subscription_item_details",
      invoice_item_details: null,
      subscription_item_details: {
        invoice_item: null,
        proration: false,
        proration_details: null,
        subscription: "sub_SYNTHETIC",
        subscription_item: "si_SYNTHETIC",
      },
    },
    period: { start: 100, end: 200 },
    pretax_credit_amounts: [
      {
        type: "discount",
        discount: "di_ITEM",
        amount: 100,
        credit_balance_transaction: null,
      },
    ],
    pricing: {
      type: "price_details",
      price_details: { price: "price_SYNTHETIC", product: "prod_SYNTHETIC" },
      unit_amount_decimal: "00009.0900",
    },
    quantity: 1,
    quantity_decimal: "01.000",
    subscription: null,
    subtotal: 1000,
    taxes: [],
    metadata: {},
  };
}
export const page = () => ({ object: "list", has_more: false, data: [line()] });
