import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

const CONFIGURATION_LABELS: Record<string, string> = {
  recipient: "Recipient (payouts)",
  customer: "Customer (billable)",
  merchant: "Merchant (card payments)",
};

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
        <div className="flex flex-wrap gap-2">
          {configurations.length === 0 && (
            <span className="text-muted-foreground text-sm">No data yet</span>
          )}
          {configurations.map((c) => (
            <Badge key={c} variant="default">
              {CONFIGURATION_LABELS[c] ?? c}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
