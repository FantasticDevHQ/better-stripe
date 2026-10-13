import { EmptyState } from "@/components/empty-state";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useRole } from "@/providers/role-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function StoreSubscribe() {
  const { currentUser } = useRole();
  const subscriptions = useQuery(api.storefront.listStoreSubscriptions, {
    sellerId:
      currentUser.id as import("../../../convex/_generated/dataModel").Id<"users">,
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Subscriptions</h1>
      <p className="text-muted-foreground">
        Customers subscribed to your store, showing the latest 100 subscriptions
        per plan. To buy a subscription, choose Customer or Visitor and visit
        Stores.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Subscribers</CardTitle>
        </CardHeader>
        <CardContent>
          {subscriptions === undefined ? (
            <Skeleton className="h-32" />
          ) : subscriptions.length ? (
            <ul className="space-y-3">
              {subscriptions.map((s) => (
                <li
                  key={s.stripeSubscriptionId}
                  className="flex justify-between gap-3"
                >
                  <span>{s.stripeSubscriptionId}</span>
                  <span>{s.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No store subscriptions yet.</EmptyState>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
