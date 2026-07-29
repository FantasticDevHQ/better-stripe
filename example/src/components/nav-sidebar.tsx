import { useState } from "react";

import { Menu, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { type Role, useRole } from "@/providers/role-context";
import { Link, NavLink } from "react-router-dom";

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
    { label: "Affiliate Split", to: "/marketplace/split" },
    { label: "Destination Charge + Fee", to: "/demo/destination-charge" },
    { label: "Store Subscription", to: "/demo/subscribe" },
    { label: "Store Earnings", to: "/demo/store-earnings" },
  ],
  seller: [
    { label: "Earnings", to: "/seller", end: true },
    { label: "Products", to: "/seller/products" },
    { label: "Onboarding", to: "/seller/onboarding" },
    { label: "Payouts", to: "/seller/payouts" },
    { label: "Disputes", to: "/seller/disputes" },
    { label: "Refunds & reversals", to: "/seller/refunds" },
    { label: "Account", to: "/seller/account" },
    { label: "Marketplace Account", to: "/seller/marketplace-account" },
  ],
  admin: [
    { label: "Overview", to: "/admin", end: true },
    { label: "Products", to: "/admin/products" },
    { label: "Subscriptions", to: "/admin/subscriptions" },
    { label: "Webhooks", to: "/admin/webhooks" },
    { label: "Testing", to: "/admin/testing" },
    { label: "Setup", to: "/admin/setup" },
  ],
  // Visitor has no Stripe account yet — they see the customer surface, which
  // renders pre-onboarding empty-states and CTAs rather than billing data.
  visitor: [
    { label: "Dashboard", to: "/dashboard", end: true },
    { label: "Billing", to: "/dashboard/billing" },
    { label: "Invoices", to: "/dashboard/invoices" },
    { label: "Payment Methods", to: "/dashboard/payment-methods" },
  ],
};

export function NavSidebar() {
  const { currentRole } = useRole();
  const items = NAV_ITEMS[currentRole];
  const [openMobile, setOpenMobile] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="fixed top-2.5 left-4 z-50 md:hidden"
        aria-label="Open navigation menu"
        aria-expanded={openMobile}
        aria-controls="mobile-navigation"
        onClick={() => setOpenMobile(true)}
      >
        <Menu />
      </Button>

      <nav
        className="border-border hidden w-56 shrink-0 border-r p-4 md:block"
        aria-label="Primary navigation"
      >
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cn(
              buttonVariants({ variant: isActive ? "secondary" : "ghost" }),
              "w-full justify-start",
              isActive && "font-medium",
            )
          }
        >
          Home
        </NavLink>
        <Separator className="my-4" />
        <div className="text-muted-foreground mb-4 text-xs font-semibold tracking-wider uppercase">
          {currentRole === "customer" && "Customer"}
          {currentRole === "seller" && "Seller"}
          {currentRole === "admin" && "Admin"}
          {currentRole === "visitor" && "Visitor"}
        </div>
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    buttonVariants({
                      variant: isActive ? "secondary" : "ghost",
                    }),
                    "w-full justify-start",
                    isActive && "font-medium",
                  )
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {openMobile && (
        <div
          id="mobile-navigation"
          data-mobile={openMobile}
          className="fixed inset-0 z-50 flex md:hidden"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close navigation menu"
            onClick={() => setOpenMobile(false)}
          />
          <nav
            className="bg-background relative z-10 h-full w-72 overflow-y-auto border-r p-4 shadow-xl"
            aria-label="Mobile navigation"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">BetterTees</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation menu"
                onClick={() => setOpenMobile(false)}
              >
                <X />
              </Button>
            </div>
            <Link
              to="/"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "w-full justify-start",
              )}
              onClick={() => setOpenMobile(false)}
            >
              Home
            </Link>
            <Separator className="my-4" />
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        buttonVariants({
                          variant: isActive ? "secondary" : "ghost",
                        }),
                        "w-full justify-start",
                        isActive && "font-medium",
                      )
                    }
                    onClick={() => setOpenMobile(false)}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </>
  );
}
