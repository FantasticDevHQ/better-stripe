import { AccountConfigurations as BetterStripeAccountConfigurations } from "@fantastic.dev/better-stripe/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
export function AccountConfigurations({
  configurations,
}: {
  configurations: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Applied Configurations</CardTitle>
        <CardDescription>
          What this ONE Stripe account is currently allowed to do.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BetterStripeAccountConfigurations configurations={configurations}>
          {({ items, isEmpty }) => (
            <div className="flex flex-wrap gap-2">
              {isEmpty && (
                <span className="text-muted-foreground text-sm">
                  No data yet
                </span>
              )}
              {items.map((item) => (
                <Badge key={item.key} variant="default">
                  {item.label}
                </Badge>
              ))}
            </div>
          )}
        </BetterStripeAccountConfigurations>
      </CardContent>
    </Card>
  );
}
