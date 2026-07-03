import { AppShell } from "@/components/app-shell";
import { AdminOverview } from "@/pages/admin/index";
import { AdminProducts } from "@/pages/admin/products";
import { AdminSubscriptions } from "@/pages/admin/subscriptions";
import { AdminTesting } from "@/pages/admin/testing";
import { AdminSetup } from "@/pages/admin/setup";
import { AdminWebhooks } from "@/pages/admin/webhooks";
import { Checkout } from "@/pages/checkout";
import { CheckoutStatusPage } from "@/pages/checkout-status";
import { SellerAccount } from "@/pages/seller/account";
import { SellerHome } from "@/pages/seller/index";
import { SellerOnboarding } from "@/pages/seller/onboarding";
import { Payouts } from "@/pages/seller/payouts";
import { SellerProducts } from "@/pages/seller/products";
import { Billing } from "@/pages/dashboard/billing";
import { Dashboard } from "@/pages/dashboard/index";
import { Invoices } from "@/pages/dashboard/invoices";
import { PaymentMethods } from "@/pages/dashboard/payment-methods";
import { Landing } from "@/pages/landing";
import { AffiliateSplitDemo } from "@/pages/marketplace/split";
import { RoleProvider } from "@/providers/role-context";
import { Route, Routes } from "react-router-dom";

export default function App() {
  return (
    <RoleProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Landing />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/checkout/status" element={<CheckoutStatusPage />} />

          {/* Marketplace demos */}
          <Route path="/marketplace/split" element={<AffiliateSplitDemo />} />

          {/* Customer routes */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dashboard/billing" element={<Billing />} />
          <Route path="/dashboard/invoices" element={<Invoices />} />
          <Route
            path="/dashboard/payment-methods"
            element={<PaymentMethods />}
          />

          {/* Seller routes */}
          <Route path="/seller" element={<SellerHome />} />
          <Route path="/seller/onboarding" element={<SellerOnboarding />} />
          <Route path="/seller/payouts" element={<Payouts />} />
          <Route path="/seller/products" element={<SellerProducts />} />
          <Route path="/seller/account" element={<SellerAccount />} />

          {/* Admin routes */}
          <Route path="/admin" element={<AdminOverview />} />
          <Route path="/admin/products" element={<AdminProducts />} />
          <Route path="/admin/subscriptions" element={<AdminSubscriptions />} />
          <Route path="/admin/webhooks" element={<AdminWebhooks />} />
          <Route path="/admin/testing" element={<AdminTesting />} />
          <Route path="/admin/setup" element={<AdminSetup />} />
        </Route>
      </Routes>
    </RoleProvider>
  );
}
