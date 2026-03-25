import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { type Role, useRole } from '@/providers/role-context';
import { NavLink } from 'react-router-dom';

interface NavItem {
  label: string;
  to: string;
}

const NAV_ITEMS: Record<Role, NavItem[]> = {
  learner: [
    { label: 'Dashboard', to: '/dashboard' },
    { label: 'Billing', to: '/dashboard/billing' },
    { label: 'Invoices', to: '/dashboard/invoices' },
    { label: 'Payment Methods', to: '/dashboard/payment-methods' },
  ],
  creator: [
    { label: 'Earnings', to: '/creator' },
    { label: 'Products', to: '/creator/products' },
    { label: 'Onboarding', to: '/creator/onboarding' },
    { label: 'Payouts', to: '/creator/payouts' },
    { label: 'Account', to: '/creator/account' },
  ],
  admin: [
    { label: 'Overview', to: '/admin' },
    { label: 'Products', to: '/admin/products' },
    { label: 'Subscriptions', to: '/admin/subscriptions' },
    { label: 'Webhooks', to: '/admin/webhooks' },
    { label: 'Testing', to: '/admin/testing' },
  ],
};

export function NavSidebar() {
  const { currentRole } = useRole();
  const items = NAV_ITEMS[currentRole];

  return (
    <nav className="border-border w-56 shrink-0 border-r p-4">
      <div className="text-muted-foreground mb-4 text-xs font-semibold tracking-wider uppercase">
        {currentRole === 'learner' && 'Learner'}
        {currentRole === 'creator' && 'Creator'}
        {currentRole === 'admin' && 'Admin'}
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} className="block">
              {({ isActive }) => (
                <Button
                  variant={isActive ? 'secondary' : 'ghost'}
                  className={cn(
                    'w-full justify-start',
                    isActive && 'font-medium',
                  )}
                >
                  {item.label}
                </Button>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      <Separator className="my-4" />
      <NavLink to="/" className="block" end>
        {({ isActive }) => (
          <Button
            variant={isActive ? 'secondary' : 'ghost'}
            className={cn('w-full justify-start', isActive && 'font-medium')}
          >
            Home
          </Button>
        )}
      </NavLink>
    </nav>
  );
}
