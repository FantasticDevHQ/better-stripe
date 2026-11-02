import { MeteredUsageDemo } from "@/components/metered-usage-demo";
import { AdminAffiliateRecovery } from "@/pages/admin/affiliate-recovery";
import { AffiliateRecoveryDemo } from "@/pages/demo/affiliate-recovery";
import { AllocationPreview } from "@/pages/demo/allocation";
import { IntegrationExamples } from "@/components/integration-examples";
import { ConnectExample } from "@/components/connect-example";
import {
  ProductComponents,
  SubscriptionComponents,
  HostedBillingExample,
} from "@/components/package-examples";
import { AppShell } from "@/components/app-shell";
import { AdminOverview } from "@/pages/admin/index";
import { AdminStorePlans } from "@/pages/admin/store-plans";
import { AdminProducts } from "@/pages/admin/products";
import { AdminSubscriptions } from "@/pages/admin/subscriptions";
import { AdminTesting } from "@/pages/admin/testing";
import { AdminSetup } from "@/pages/admin/setup";
import { AdminWebhooks } from "@/pages/admin/webhooks";
import { Checkout } from "@/pages/checkout";
import { CheckoutStatusPage } from "@/pages/checkout-status";
import { StoreSubscribe } from "@/pages/demo/subscribe";
import { StoreEarnings } from "@/pages/demo/store-earnings";
import { SellerSales } from "@/pages/seller/sales";
import { SellerPlan } from "@/pages/seller/plan";
import { SellerAccount } from "@/pages/seller/account";
import { SellerHome } from "@/pages/seller/index";
import { SellerDisputes } from "@/pages/seller/disputes";
import { Payouts } from "@/pages/seller/payouts";
import { SellerProducts } from "@/pages/seller/products";
import { SellerRefunds } from "@/pages/seller/refunds";
import { Billing } from "@/pages/dashboard/billing";
import { Dashboard } from "@/pages/dashboard/index";
import { Invoices } from "@/pages/dashboard/invoices";
import { PaymentMethods } from "@/pages/dashboard/payment-methods";
import { Landing } from "@/pages/landing";
import { Affiliate, AffiliateSales, AffiliateLinks } from "@/pages/affiliate";
import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import {
  parseSearch,
  stringifySearch,
  validateSearch,
} from "@/lib/router-search";
import {
  LegacySplit,
  LegacyAccount,
} from "@/components/legacy-route-redirects";
import { RoleProvider } from "@/providers/role-context";

const rootRoute = createRootRoute({
  validateSearch,
  component: () => (
    <RoleProvider>
      <AppShell />
    </RoleProvider>
  ),
});
const route = <const Path extends string>(
  path: Path,
  component: () => React.ReactNode,
) => createRoute({ getParentRoute: () => rootRoute, path, component });
const routeTree = rootRoute.addChildren([
  route("/", () => <Landing />),
  route("/stores", () => <Landing />),
  route("/affiliate", () => (
    <IntegrationExamples
      headless={<Affiliate />}
      components={<Affiliate integration="components" />}
      embedded={<ConnectExample kind="balances" />}
    />
  )),
  route("/affiliate/sales", () => <AffiliateSales />),
  route("/affiliate/links", () => <AffiliateLinks />),
  route("/checkout", () => <Checkout />),
  route("/checkout/status", () => <CheckoutStatusPage />),
  route("/demo/subscribe", () => (
    <IntegrationExamples
      headless={<StoreSubscribe />}
      components={<SubscriptionComponents />}
      note="These are your customers’ subscriptions. Connect embeds do not manage the platform’s subscription catalog."
    />
  )),
  route("/demo/store-earnings", () => (
    <IntegrationExamples
      headless={<StoreEarnings />}
      components={<StoreEarnings />}
      embedded={<ConnectExample kind="balances" />}
    />
  )),
  route("/demo/affiliate-recovery", () => <AffiliateRecoveryDemo />),
  route("/demo/metered-usage", () => <MeteredUsageDemo />),
  route("/demo/allocation", () => <AllocationPreview />),
  route("/marketplace/split", () => <LegacySplit />),
  route("/demo/destination-charge", () => <LegacySplit />),
  route("/dashboard", () => <Dashboard />),
  route("/dashboard/billing", () => (
    <IntegrationExamples
      headless={<Billing />}
      components={<Billing integration="components" />}
      hosted={<HostedBillingExample />}
    />
  )),
  route("/dashboard/invoices", () => (
    <IntegrationExamples
      headless={<Invoices />}
      hosted={<HostedBillingExample />}
    />
  )),
  route("/dashboard/payment-methods", () => (
    <IntegrationExamples
      headless={<PaymentMethods />}
      hosted={<HostedBillingExample />}
    />
  )),
  route("/seller/sales", () => (
    <IntegrationExamples
      headless={<SellerSales />}
      embedded={<ConnectExample kind="payments" />}
    />
  )),
  route("/seller/plan", () => (
    <IntegrationExamples
      headless={<SellerPlan />}
      hosted={<HostedBillingExample />}
    />
  )),
  route("/seller", () => <SellerHome />),
  route("/seller/onboarding", () => <LegacyAccount section="setup" />),
  route("/seller/payouts", () => (
    <IntegrationExamples
      headless={<Payouts />}
      components={<Payouts />}
      embedded={<ConnectExample kind="payouts" />}
    />
  )),
  route("/affiliate/payouts", () => (
    <IntegrationExamples
      headless={<Payouts />}
      components={<Payouts />}
      embedded={<ConnectExample kind="payouts" />}
    />
  )),
  route("/seller/disputes", () => <SellerDisputes />),
  route("/seller/refunds", () => (
    <IntegrationExamples
      headless={<SellerRefunds />}
      embedded={<ConnectExample kind="refunds" />}
    />
  )),
  route("/seller/products", () => (
    <IntegrationExamples
      headless={<SellerProducts />}
      components={<ProductComponents />}
      note="Stripe Connect has no embedded product catalog. Compare custom catalog management with package price components."
    />
  )),
  route("/seller/account", () => <SellerAccount />),
  route("/seller/marketplace-account", () => (
    <LegacyAccount section="stripe-settings" />
  )),
  route("/admin", () => <AdminOverview />),
  route("/admin/store-plans", () => <AdminStorePlans />),
  route("/admin/products", () => (
    <IntegrationExamples
      headless={<AdminProducts />}
      components={<ProductComponents />}
    />
  )),
  route("/admin/subscriptions", () => (
    <IntegrationExamples
      headless={<AdminSubscriptions />}
      components={<SubscriptionComponents />}
    />
  )),
  route("/admin/webhooks", () => <AdminWebhooks />),
  route("/admin/affiliate-recovery", () => <AdminAffiliateRecovery />),
  route("/admin/testing", () => <AdminTesting />),
  route("/admin/setup", () => <AdminSetup />),
]);

// Each test/application instance owns its history. No TanStack Start server runtime.
export function createExampleRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, parseSearch, stringifySearch });
}
export const router = createExampleRouter();
export type RoutePath = keyof typeof router.routesByPath;
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
