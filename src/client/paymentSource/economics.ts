/** The existing settlement amount/currency rules, shared without changing its result contract. */
export function saleAmountFailure(
  payment: { currency: string; amount_received: number },
  charge: { currency: string; amount: number },
  balance: { currency: string; fee: number },
): "currency" | "amounts" | null {
  if (
    balance.currency !== payment.currency ||
    charge.currency !== payment.currency
  )
    return "currency";
  if (
    ![payment.amount_received, balance.fee].every(Number.isSafeInteger) ||
    balance.fee < 0 ||
    balance.fee > payment.amount_received ||
    charge.amount !== payment.amount_received
  )
    return "amounts";
  return null;
}
