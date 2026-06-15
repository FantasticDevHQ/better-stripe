"use client";

export type PaymentMethodInfo = {
  id: string;
  type: string;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  isDefault: boolean;
};

export type UsePaymentMethodsResult = {
  methods: PaymentMethodInfo[] | undefined;
  defaultMethod: PaymentMethodInfo | null;
  isLoading: boolean;
};

/**
 * Factory for a hook that lists a customer's saved payment methods.
 *
 * The `useQuery` binding must support Convex's `"skip"` sentinel.
 */
export function createUsePaymentMethods(
  useQuery: (queryRef: any, args: Record<string, unknown> | "skip") => any,
  queryRef: any,
) {
  return function usePaymentMethods(
    accountId: string | undefined,
  ): UsePaymentMethodsResult {
    const methods = useQuery(queryRef, accountId ? { accountId } : "skip");

    const defaultMethod =
      methods?.find((m: PaymentMethodInfo) => m.isDefault) ?? null;

    return {
      methods,
      defaultMethod,
      isLoading: methods === undefined && accountId !== undefined,
    };
  };
}
