import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "../../../convex/_generated/api";

const quickLinks = [
  {
    to: "/admin/products",
    label: "Products & Prices",
    description: "Manage your product catalog and pricing",
  },
  {
    to: "/admin/subscriptions",
    label: "Subscriptions",
    description: "View and manage all subscriptions",
  },
  {
    to: "/admin/webhooks",
    label: "Webhook Events",
    description: "Monitor incoming Stripe webhook events",
  },
  {
    to: "/admin/testing",
    label: "Testing",
    description: "Test Stripe integration and events",
  },
  {
    to: "/admin/setup",
    label: "Setup",
    description: "Configure webhooks, seed data, and sync from Stripe",
  },
];

export function AdminOverview() {
  const stripeMode = useQuery(api.queries.getStripeMode) ?? "test";
  const products = useQuery(api.queries.listProducts);
  const subscriptions = useQuery(api.queries.listSubscriptions);

  const isLoading = products === undefined || subscriptions === undefined;
  const totalProducts = products?.length ?? 0;
  const totalSubscriptions = subscriptions?.length ?? 0;
  const activeSubscriptions =
    subscriptions?.filter((s) => s.status === "active").length ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Overview</h1>
        <Badge variant={stripeMode === "test" ? "secondary" : "default"}>
          <span
            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
              stripeMode === "test" ? "bg-yellow-500" : "bg-green-500"
            }`}
          />
          {stripeMode === "test" ? "Test Mode" : "Live Mode"}
        </Badge>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Subscriptions", value: totalSubscriptions },
          { label: "Active Subscriptions", value: activeSubscriptions },
          { label: "Total Products", value: totalProducts },
          { label: "Data Status", value: isLoading ? "Loading..." : "Live" },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="pb-2">
              <CardDescription>{metric.label}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading && typeof metric.value === "number" ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <p
                  className="text-3xl font-bold"
                  aria-live={
                    metric.label === "Data Status" ? "polite" : undefined
                  }
                >
                  {metric.value}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && totalProducts === 0 && totalSubscriptions === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No data yet</CardTitle>
            <CardDescription>
              Create your first product or run a checkout to populate these
              admin metrics.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Quick Links */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Quick Links</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {quickLinks.map((link) => (
            <Link key={link.to} to={link.to}>
              <Card className="hover:border-primary/50 transition-colors">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {link.label}
                    <ArrowRight className="text-muted-foreground h-4 w-4" />
                  </CardTitle>
                  <CardDescription>{link.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
