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

export function createUsePaymentMethods(
  useQuery: (queryRef: any, args: any) => any,
  queryRef: any,
) {
  return function usePaymentMethods(
    accountId: string | undefined,
  ): UsePaymentMethodsResult {
    const methods = accountId ? useQuery(queryRef, { accountId }) : undefined;

    const defaultMethod =
      methods?.find((m: PaymentMethodInfo) => m.isDefault) ?? null;

    return {
      methods,
      defaultMethod,
      isLoading: methods === undefined && accountId !== undefined,
    };
  };
}
