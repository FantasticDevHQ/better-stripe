import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { type Role, useRole } from "@/providers/role-context";
import { NavLink } from "react-router-dom";

interface NavItem {
  label: string;
  to: string;
  end?: boolean;
}

const NAV_ITEMS: Record<Role, NavItem[]> = {
  customer: [
    { label: "Dashboard", to: "/dashboard", end: true },
    { label: "Billing", to: "/dashboard/billing" },
    { label: "Invoices", to: "/dashboard/invoices" },
    { label: "Payment Methods", to: "/dashboard/payment-methods" },
  ],
  seller: [
    { label: "Earnings", to: "/seller", end: true },
    { label: "Products", to: "/seller/products" },
    { label: "Onboarding", to: "/seller/onboarding" },
    { label: "Payouts", to: "/seller/payouts" },
    { label: "Account", to: "/seller/account" },
  ],
  admin: [
    { label: "Overview", to: "/admin", end: true },
    { label: "Products", to: "/admin/products" },
    { label: "Subscriptions", to: "/admin/subscriptions" },
    { label: "Webhooks", to: "/admin/webhooks" },
    { label: "Testing", to: "/admin/testing" },
    { label: "Setup", to: "/admin/setup" },
  ],
};

export function NavSidebar() {
  const { currentRole } = useRole();
  const items = NAV_ITEMS[currentRole];

  return (
    <nav className="border-border w-56 shrink-0 border-r p-4">
      <NavLink to="/" className="block" end>
        {({ isActive }) => (
          <Button
            variant={isActive ? "secondary" : "ghost"}
            className={cn("w-full justify-start", isActive && "font-medium")}
          >
            Home
          </Button>
        )}
      </NavLink>
      <Separator className="my-4" />
      <div className="text-muted-foreground mb-4 text-xs font-semibold tracking-wider uppercase">
        {currentRole === "customer" && "Customer"}
        {currentRole === "seller" && "Seller"}
        {currentRole === "admin" && "Admin"}
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} className="block" end={item.end}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start",
                    isActive && "font-medium",
                  )}
                >
                  {item.label}
                </Button>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
