import { AppShell } from '@/components/app-shell';
import { AdminOverview } from '@/pages/admin/index';
import { AdminProducts } from '@/pages/admin/products';
import { AdminSubscriptions } from '@/pages/admin/subscriptions';
import { AdminTesting } from '@/pages/admin/testing';
import { AdminWebhooks } from '@/pages/admin/webhooks';
import { Checkout } from '@/pages/checkout';
import { CheckoutStatusPage } from '@/pages/checkout-status';
import { CreatorAccount } from '@/pages/creator/account';
import { CreatorHome } from '@/pages/creator/index';
import { Onboarding } from '@/pages/creator/onboarding';
import { Payouts } from '@/pages/creator/payouts';
import { CreatorProducts } from '@/pages/creator/products';
import { Billing } from '@/pages/dashboard/billing';
import { Dashboard } from '@/pages/dashboard/index';
import { Invoices } from '@/pages/dashboard/invoices';
import { PaymentMethods } from '@/pages/dashboard/payment-methods';
import { Landing } from '@/pages/landing';
import { RoleProvider } from '@/providers/role-context';
import { Route, Routes } from 'react-router-dom';

export default function App() {
  return (
    <RoleProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Landing />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/checkout/status" element={<CheckoutStatusPage />} />

          {/* Learner routes */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dashboard/billing" element={<Billing />} />
          <Route path="/dashboard/invoices" element={<Invoices />} />
          <Route
            path="/dashboard/payment-methods"
            element={<PaymentMethods />}
          />

          {/* Creator routes */}
          <Route path="/creator" element={<CreatorHome />} />
          <Route path="/creator/onboarding" element={<Onboarding />} />
          <Route path="/creator/payouts" element={<Payouts />} />
          <Route path="/creator/products" element={<CreatorProducts />} />
          <Route path="/creator/account" element={<CreatorAccount />} />

          {/* Admin routes */}
          <Route path="/admin" element={<AdminOverview />} />
          <Route path="/admin/products" element={<AdminProducts />} />
          <Route path="/admin/subscriptions" element={<AdminSubscriptions />} />
          <Route path="/admin/webhooks" element={<AdminWebhooks />} />
          <Route path="/admin/testing" element={<AdminTesting />} />
        </Route>
      </Routes>
    </RoleProvider>
  );
}
