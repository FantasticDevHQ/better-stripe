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
import { Navigate, useSearchParams } from "react-router-dom";
import { RoleProvider } from "@/providers/role-context";
import { Route, Routes } from "react-router-dom";

function LegacySplit() {
  const [params] = useSearchParams();
  return <Navigate to={`/stores?${params}`} replace />;
}

function LegacyAccount({ section }: { section: "setup" | "stripe-settings" }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set("section", section);
  return <Navigate to={`/seller/account?${next}`} replace />;
}
export default function App() {
  return (
    <RoleProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Landing />} />
          <Route path="/stores" element={<Landing />} />
          <Route
            path="/affiliate"
            element={
              <IntegrationExamples
                headless={<Affiliate />}
                components={<Affiliate integration="components" />}
                embedded={<ConnectExample kind="balances" />}
              />
            }
          />
          <Route path="/affiliate/sales" element={<AffiliateSales />} />
          <Route path="/affiliate/links" element={<AffiliateLinks />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/checkout/status" element={<CheckoutStatusPage />} />

          {/* BTS-42 marketplace subscription + payout demo */}
          <Route
            path="/demo/subscribe"
            element={
              <IntegrationExamples
                headless={<StoreSubscribe />}
                components={<SubscriptionComponents />}
                note="These are your customers’ subscriptions. Connect embeds do not manage the platform’s subscription catalog."
              />
            }
          />
          <Route
            path="/demo/store-earnings"
            element={
              <IntegrationExamples
                headless={<StoreEarnings />}
                components={<StoreEarnings />}
                embedded={<ConnectExample kind="balances" />}
              />
            }
          />

          <Route path="/demo/allocation" element={<AllocationPreview />} />

          {/* Marketplace demos */}
          <Route path="/marketplace/split" element={<LegacySplit />} />

          {/* BTS-58 destination-charge + platform-fee demo (single recipient) */}
          <Route path="/demo/destination-charge" element={<LegacySplit />} />

          {/* Customer routes */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route
            path="/dashboard/billing"
            element={
              <IntegrationExamples
                headless={<Billing />}
                components={<Billing integration="components" />}
                hosted={<HostedBillingExample />}
              />
            }
          />
          <Route
            path="/dashboard/invoices"
            element={
              <IntegrationExamples
                headless={<Invoices />}
                hosted={<HostedBillingExample />}
              />
            }
          />
          <Route
            path="/dashboard/payment-methods"
            element={
              <IntegrationExamples
                headless={<PaymentMethods />}
                hosted={<HostedBillingExample />}
              />
            }
          />

          {/* Seller routes */}
          <Route
            path="/seller/sales"
            element={
              <IntegrationExamples
                headless={<SellerSales />}
                embedded={<ConnectExample kind="payments" />}
              />
            }
          />
          <Route
            path="/seller/plan"
            element={
              <IntegrationExamples
                headless={<SellerPlan />}
                hosted={<HostedBillingExample />}
              />
            }
          />
          <Route path="/seller" element={<SellerHome />} />
          <Route
            path="/seller/onboarding"
            element={<LegacyAccount section="setup" />}
          />
          <Route
            path="/seller/payouts"
            element={
              <IntegrationExamples
                headless={<Payouts />}
                components={<Payouts />}
                embedded={<ConnectExample kind="payouts" />}
              />
            }
          />
          <Route
            path="/affiliate/payouts"
            element={
              <IntegrationExamples
                headless={<Payouts />}
                components={<Payouts />}
                embedded={<ConnectExample kind="payouts" />}
              />
            }
          />
          <Route path="/seller/disputes" element={<SellerDisputes />} />
          <Route
            path="/seller/refunds"
            element={
              <IntegrationExamples
                headless={<SellerRefunds />}
                embedded={<ConnectExample kind="refunds" />}
              />
            }
          />
          <Route
            path="/seller/products"
            element={
              <IntegrationExamples
                headless={<SellerProducts />}
                components={<ProductComponents />}
                note="Stripe Connect has no embedded product catalog. Compare custom catalog management with package price components."
              />
            }
          />
          <Route path="/seller/account" element={<SellerAccount />} />
          <Route
            path="/seller/marketplace-account"
            element={<LegacyAccount section="stripe-settings" />}
          />

          {/* Admin routes */}
          <Route path="/admin" element={<AdminOverview />} />
          <Route path="/admin/store-plans" element={<AdminStorePlans />} />
          <Route
            path="/admin/products"
            element={
              <IntegrationExamples
                headless={<AdminProducts />}
                components={<ProductComponents />}
              />
            }
          />
          <Route
            path="/admin/subscriptions"
            element={
              <IntegrationExamples
                headless={<AdminSubscriptions />}
                components={<SubscriptionComponents />}
              />
            }
          />
          <Route path="/admin/webhooks" element={<AdminWebhooks />} />
          <Route path="/admin/testing" element={<AdminTesting />} />
          <Route path="/admin/setup" element={<AdminSetup />} />
        </Route>
      </Routes>
    </RoleProvider>
  );
}
