export const STRIPE_DASHBOARD_BASE_URL = 'https://dashboard.stripe.com';

export const StripeDashboardResourcePath = {
  Product: 'products',
  Price: 'prices',
  Customer: 'customers',
  Subscription: 'subscriptions',
} as const;

export type StripeDashboardResourceType =
  | 'product'
  | 'price'
  | 'customer'
  | 'subscription';

export type StripeMode = 'test' | 'live';

function normalizeStripeMode(
  stripeMode: string | null | undefined,
): StripeMode | undefined {
  if (stripeMode === 'test' || stripeMode === 'live') {
    return stripeMode;
  }

  return undefined;
}

function inferStripeModeFromKey(
  key: string | null | undefined,
): StripeMode | undefined {
  if (key?.startsWith('pk_test_') || key?.startsWith('sk_test_')) {
    return 'test';
  }

  if (key?.startsWith('pk_live_') || key?.startsWith('sk_live_')) {
    return 'live';
  }

  return undefined;
}

export function isStripeTestMode(stripeMode?: string | null): boolean {
  const explicitMode = normalizeStripeMode(stripeMode);

  if (explicitMode) {
    return explicitMode === 'test';
  }

  const inferredMode =
    inferStripeModeFromKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) ??
    inferStripeModeFromKey(process.env.STRIPE_PUBLISHABLE_KEY) ??
    inferStripeModeFromKey(process.env.STRIPE_SECRET_KEY);

  return inferredMode === 'test';
}

export function getStripeDashboardUrl(
  resourceType: StripeDashboardResourceType,
  resourceId: string,
  stripeMode?: string | null,
): string {
  const modePath = isStripeTestMode(stripeMode) ? '/test' : '';

  const resourcePath =
    StripeDashboardResourcePath[
      (resourceType.charAt(0).toUpperCase() +
        resourceType.slice(1)) as keyof typeof StripeDashboardResourcePath
    ];

  return `${STRIPE_DASHBOARD_BASE_URL}${modePath}/${resourcePath}/${resourceId}`;
}
