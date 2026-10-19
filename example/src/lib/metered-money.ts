export const money = (amount: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount / 100,
  );
