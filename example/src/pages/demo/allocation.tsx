import { allocateSale } from "@fantastic.dev/better-stripe";
import { SplitBreakdown } from "@fantastic.dev/better-stripe/react";
import { Card, CardContent } from "@/components/ui/card";
const preview = allocateSale({
  gross: 10000,
  processingFee: 320,
  feeBasisPoints: 900,
  creatorAccountId: "creator",
  affiliate: { destinationAccountId: "affiliate", basisPoints: 2000 },
  collaborators: [{ destinationAccountId: "collaborator", basisPoints: 2500 }],
});
const previewBreakdown = {
  legs: preview.transfers.map((t, i) => ({
    ...t,
    stripeTransferId: `preview-${i}`,
    reversedAmount: 0,
    net: t.amount,
    currency: "usd",
  })),
  store: preview.creatorNet,
  affiliate: preview.affiliateNet,
  other: preview.collaboratorNet,
  recipientsTotal: preview.transfers.reduce((sum, t) => sum + t.amount, 0),
  platform: preview.sellingFee,
};
export function AllocationPreview() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Settlement allocation</h1>
      <Card>
        <CardContent padding="lg">
          <h2 className="text-lg font-semibold">
            Fee-first allocation preview
          </h2>
          <p className="text-sm text-muted-foreground">
            Illustrative $100 sale: $3.20 processing, a 9% inclusive fee, 20%
            affiliate commission, then 25% of the creator remainder for a
            collaborator. These are explicit preview inputs, not your store
            settings.
          </p>
          <SplitBreakdown
            breakdown={previewBreakdown}
            labels={{
              store: "Creator",
              other: "Collaborator",
              platform: "Fees (Stripe + platform)",
            }}
          >
            {({ lines }) => (
              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                {lines.map((line) => (
                  <Card key={line.key}>
                    <CardContent padding="lg">
                      <dt className="text-muted-foreground text-sm">
                        {line.label}
                      </dt>
                      <dd className="mt-2 text-2xl font-semibold">
                        {line.amountLabel}
                      </dd>
                    </CardContent>
                  </Card>
                ))}
              </dl>
            )}
          </SplitBreakdown>
        </CardContent>
      </Card>
    </div>
  );
}
