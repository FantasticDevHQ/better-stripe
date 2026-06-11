/**
 * Tests for the Convex "skip" sentinel behavior in query hook factories —
 * pins that useQuery is ALWAYS called (rules of hooks compliance) with
 * "skip" when the id argument is undefined, and with the real args
 * object when it is provided.
 */
import { describe, expect, it, vi } from "vitest";

import { createUseAccount } from "./useAccount.js";
import { createUseAccountOnboarding } from "./useAccountOnboarding.js";
import { createUseCheckout } from "./useCheckout.js";
import { createUsePaymentMethods } from "./usePaymentMethods.js";
import { createUsePrices } from "./usePrices.js";
import { createUseSubscription } from "./useSubscription.js";

type SkipFactory = (
  useQuery: (queryRef: any, args: Record<string, unknown> | "skip") => any,
  queryRef: any,
) => (id: string | undefined) => { isLoading: boolean };

const cases: {
  name: string;
  factory: SkipFactory;
  id: string;
  args: Record<string, unknown>;
}[] = [
  {
    name: "createUseAccount",
    factory: createUseAccount,
    id: "user_123",
    args: { userId: "user_123" },
  },
  {
    name: "createUsePaymentMethods",
    factory: createUsePaymentMethods,
    id: "acct_123",
    args: { accountId: "acct_123" },
  },
  {
    name: "createUseSubscription",
    factory: createUseSubscription,
    id: "sub_123",
    args: { subscriptionId: "sub_123" },
  },
  {
    name: "createUseCheckout",
    factory: createUseCheckout,
    id: "cs_123",
    args: { sessionId: "cs_123" },
  },
  {
    name: "createUseAccountOnboarding",
    factory: createUseAccountOnboarding,
    id: "acct_456",
    args: { accountId: "acct_456" },
  },
  {
    name: "createUsePrices",
    factory: createUsePrices,
    id: "prod_123",
    args: { productId: "prod_123" },
  },
];

describe.each(cases)("$name skip sentinel", ({ factory, id, args }) => {
  const mockQueryRef = { __brand: "queryRef" };

  it('always calls useQuery — with "skip" when id is undefined', () => {
    const mockUseQuery = vi.fn().mockReturnValue(undefined);
    const useHook = factory(mockUseQuery, mockQueryRef);
    const result = useHook(undefined);
    expect(mockUseQuery).toHaveBeenCalledTimes(1);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, "skip");
    expect(result.isLoading).toBe(false);
  });

  it("calls useQuery with the args object when id is provided", () => {
    const mockUseQuery = vi.fn().mockReturnValue(undefined);
    const useHook = factory(mockUseQuery, mockQueryRef);
    const result = useHook(id);
    expect(mockUseQuery).toHaveBeenCalledTimes(1);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, args);
    expect(result.isLoading).toBe(true);
  });
});
