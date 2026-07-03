import { buildCheckoutReturnUrl } from "./checkout-return-url";

export function buildSplitCheckoutReturnUrl(origin: string): string {
  return buildCheckoutReturnUrl(origin);
}
