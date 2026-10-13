import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CheckoutChooser,
  SubscriptionOverview,
  PayoutHistory,
  PayoutOverview,
  ChargeSummary,
  PaymentDetails,
  Account,
  Onboarding,
  Payouts,
  Refunds,
  Products,
  Subscriptions,
  SubscriptionManager,
  BillingPlans,
  InvoiceEstimate,
  BalancePaymentSource,
  BillingPortal,
  ReferralLinks,
  Sales,
  Invoices,
  RefundHistory,
  ReferredSales,
  WebhookEvents,
  ChargebackLedger,
  CostRecovery,
  Overview,
  EnvironmentStatus,
  StripeSetup,
  SandboxTesting,
  PaymentReceipt,
  Earnings,
  Storefront,
} from "../index.js";
import type { ReactNode } from "react";
const action = vi.fn(async () => null);
const account = {
  stripeAccountId: "acct_public",
  email: "seller@example.com",
  country: "US",
  onboardingStatus: "complete",
  configurations: ["recipient"],
};
const subscription = {
  stripeSubscriptionId: "sub_public",
  status: "active",
  isTrialing: false,
  cancelAtPeriodEnd: false,
};
describe("public workflows without example providers, a router, or CSS", () => {
  const cases: [string, ReactNode][] = [
    ["CheckoutChooser", <CheckoutChooser />],
    ["SubscriptionOverview", <SubscriptionOverview subscriptions={[]} />],
    ["PayoutHistory", <PayoutHistory rows={[]} />],
    ["PayoutOverview", <PayoutOverview payouts={[]} currency="usd" />],
    [
      "ChargeSummary",
      <ChargeSummary
        gross={1000}
        fee={90}
        net={910}
        currency="usd"
        reconciles
      />,
    ],
    ["PaymentDetails", <PaymentDetails payment={null} />],
    ["Account", <Account scopeKey="seller" account={account} />],
    [
      "Onboarding",
      <Onboarding
        scopeKey="seller"
        account={null}
        createAccount={async () => ({
          onboardingUrl: "https://connect.stripe.com",
        })}
        continueOnboarding={async () => ({ url: "https://connect.stripe.com" })}
      />,
    ],
    [
      "Payouts",
      <Payouts
        scopeKey="seller"
        load={async () => ({
          balances: [],
          payouts: [],
          upcoming: [],
          nextCursor: null,
        })}
      />,
    ],
    [
      "Refunds",
      <Refunds
        scopeKey="seller"
        issueRefund={async () => ({ stripeRefundId: "re_public" })}
      />,
    ],
    [
      "Products",
      <Products
        scopeKey="seller"
        products={[]}
        createProduct={action}
        createPrice={action}
      />,
    ],
    ["Subscriptions", <Subscriptions rows={[subscription]} />],
    [
      "SubscriptionManager",
      <SubscriptionManager
        scopeKey="buyer"
        subscription={subscription}
        onAction={action}
      />,
    ],
    [
      "BillingPlans",
      <BillingPlans
        scopeKey="seller"
        publishableKey="pk_test_public"
        plans={[
          {
            id: "starter",
            name: "Starter",
            monthlyAmount: 900,
            currency: "usd",
          },
        ]}
        createCheckout={async () => ({
          stripeSessionId: "cs_public",
          clientSecret: "cs_public_secret",
        })}
        createPortal={async () => "https://billing.stripe.com"}
      />,
    ],
    [
      "InvoiceEstimate",
      <InvoiceEstimate
        scopeKey="seller"
        load={async () => ({
          total: 900,
          currency: "usd",
          nextBillingAt: 1800000000000,
          lines: [],
        })}
      />,
    ],
    [
      "BalancePaymentSource",
      <BalancePaymentSource
        scopeKey="seller"
        enabled={false}
        change={action}
      />,
    ],
    [
      "BillingPortal",
      <BillingPortal
        createSession={async () => "https://billing.stripe.com"}
      />,
    ],
    ["ReferralLinks", <ReferralLinks links={[]} />],
    ["Sales", <Sales rows={[]} />],
    ["Invoices", <Invoices rows={[]} />],
    ["RefundHistory", <RefundHistory rows={[]} />],
    ["ReferredSales", <ReferredSales rows={[]} />],
    ["WebhookEvents", <WebhookEvents rows={[]} />],
    ["CostRecovery", <CostRecovery rows={[]} />],
    ["ChargebackLedger", <ChargebackLedger chargeback={null} />],
    ["Overview", <Overview products={[]} subscriptions={[]} />],
    [
      "EnvironmentStatus",
      <EnvironmentStatus
        checks={[{ id: "secret", label: "Stripe key", configured: true }]}
      />,
    ],
    [
      "StripeSetup",
      <StripeSetup tasks={[{ id: "sync", label: "Sync", run: action }]} />,
    ],
    [
      "SandboxTesting",
      <SandboxTesting tasks={[{ id: "seed", label: "Seed", run: action }]} />,
    ],
    [
      "PaymentReceipt",
      <PaymentReceipt
        payment={{ status: "succeeded", amount: 2900, currency: "usd" }}
      />,
    ],
    [
      "Earnings",
      <Earnings
        gross={2900}
        reversed={0}
        net={2900}
        paidOut={0}
        payouts={[]}
      />,
    ],
    ["Storefront", <Storefront stores={[]} />],
  ];
  it.each(cases)(
    "%s renders unstyled native HTML independently",
    (_name, component) => {
      const markup = renderToStaticMarkup(component);
      expect(markup.length).toBeGreaterThan(0);
      expect(markup).not.toContain("class=");
      expect(markup).not.toContain("style=");
      expect(markup).not.toContain("localhost");
      expect(action).not.toHaveBeenCalled();
    },
  );
});
