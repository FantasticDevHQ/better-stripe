export type Role = "customer" | "seller" | "affiliate" | "admin" | "visitor";
export interface NavItem {
  label: string;
  to: string;
  end?: boolean;
}
export const NAV_ITEMS: Record<Role, NavItem[]> = {
  customer: [
    { label: "Stores", to: "/stores" },
    { label: "Subscriptions", to: "/dashboard/billing" },
    { label: "Invoices", to: "/dashboard/invoices" },
    { label: "Payment Methods", to: "/dashboard/payment-methods" },
  ],
  seller: [
    { label: "Earnings", to: "/demo/store-earnings" },
    { label: "Sales", to: "/seller/sales" },
    { label: "Subscriptions", to: "/demo/subscribe" },
    { label: "Products", to: "/seller/products" },
    { label: "Payouts", to: "/seller/payouts" },
    { label: "Disputes", to: "/seller/disputes" },
    { label: "Refunds", to: "/seller/refunds" },
    { label: "Account", to: "/seller/account" },
    { label: "Billing", to: "/seller/plan" },
  ],
  affiliate: [
    { label: "Referral earnings", to: "/affiliate", end: true },
    { label: "Referred sales", to: "/affiliate/sales" },
    { label: "Referral links", to: "/affiliate/links" },
    { label: "Payouts", to: "/affiliate/payouts" },
  ],
  admin: [
    { label: "Overview", to: "/admin", end: true },
    { label: "Products", to: "/admin/products" },
    { label: "Subscriptions", to: "/admin/subscriptions" },
    { label: "Webhooks", to: "/admin/webhooks" },
    { label: "Testing", to: "/admin/testing" },
    { label: "Setup", to: "/admin/setup" },
  ],
  visitor: [{ label: "Stores", to: "/stores" }],
};
export function roleHome(role: Role) {
  return {
    customer: "/stores",
    seller: "/demo/store-earnings",
    affiliate: "/affiliate",
    admin: "/admin",
    visitor: "/stores",
  }[role];
}
export function canVisit(role: Role, path: string) {
  if (path.startsWith("/admin")) return role === "admin";
  if (
    path.startsWith("/seller") ||
    path === "/demo/store-earnings" ||
    path === "/demo/subscribe"
  )
    return role === "seller";
  if (path.startsWith("/affiliate")) return role === "affiliate";
  if (path.startsWith("/dashboard")) return role === "customer";
  if (path === "/checkout" || path === "/demo/destination-charge")
    return role === "customer" || role === "visitor";
  return true;
}
