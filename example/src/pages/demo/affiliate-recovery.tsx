import { useState } from "react";
import { affiliateRecoveryScenarios } from "@fantastic.dev/better-stripe/testing";
import { RecoveryPresentation } from "@/components/affiliate-recovery-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
const scenarios = affiliateRecoveryScenarios();
export function AffiliateRecoveryDemo() {
  const [id, setId] = useState(scenarios[0].id);
  const [presentation, setPresentation] = useState<"components" | "headless">(
    "components",
  );
  const scenario = scenarios.find((row) => row.id === id)!;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-3xl font-bold">Affiliate commission recovery</h1>
      <Alert>
        <AlertDescription>
          Simulated accounting fixtures. No bank payout has been recalled, and
          these are not live Stripe receipts.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        {scenarios.map((row) => (
          <Button
            key={row.id}
            variant={row.id === id ? "default" : "outline"}
            onClick={() => setId(row.id)}
          >
            {row.label}
          </Button>
        ))}
      </div>
      <Button
        variant="outline"
        onClick={() =>
          setPresentation(
            presentation === "components" ? "headless" : "components",
          )
        }
      >
        Switch to {presentation === "components" ? "via API" : "components"}
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>{scenario.label}</CardTitle>
        </CardHeader>
        <CardContent>
          <RecoveryPresentation
            snapshot={scenario.snapshot}
            currency="usd"
            presentation={presentation}
          />
        </CardContent>
      </Card>
    </div>
  );
}
