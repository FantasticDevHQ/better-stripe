/**
 * Factory functions for creating mock Stripe webhook event payloads.
 * Useful for testing trigger handlers without hitting Stripe.
 */

type MockEvent<T = Record<string, unknown>> = {
  id: string;
  type: string;
  created: number;
  data: { object: T };
  livemode: boolean;
};

let _counter = 0;
function nextEventId(): string {
  _counter += 1;
  return `evt_test_${Date.now()}_${_counter}`;
}

export function mockCheckoutCompleted(
  overrides?: Record<string, unknown>,
): MockEvent {
  return {
    id: nextEventId(),
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: `cs_test_${Date.now()}`,
        mode: 'subscription',
        status: 'complete',
        metadata: {},
        ...overrides,
      },
    },
  };
}

export function mockSubscriptionUpdated(
  overrides?: Record<string, unknown>,
): MockEvent {
  return {
    id: nextEventId(),
    type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: `sub_test_${Date.now()}`,
        status: 'active',
        cancel_at_period_end: false,
        metadata: {},
        items: { data: [{ price: { id: 'price_test' } }] },
        ...overrides,
      },
    },
  };
}

export function mockAccountUpdated(
  overrides?: Record<string, unknown>,
): MockEvent {
  return {
    id: nextEventId(),
    type: 'account.updated',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: `acct_test_${Date.now()}`,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [] },
        ...overrides,
      },
    },
  };
}

export function mockInvoicePaid(
  overrides?: Record<string, unknown>,
): MockEvent {
  return {
    id: nextEventId(),
    type: 'invoice.paid',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: `in_test_${Date.now()}`,
        status: 'paid',
        amount_due: 2000,
        amount_paid: 2000,
        currency: 'usd',
        metadata: {},
        ...overrides,
      },
    },
  };
}
