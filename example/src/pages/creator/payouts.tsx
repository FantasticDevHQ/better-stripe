import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useQuery } from 'convex/react';

import { api } from '../../../convex/_generated/api';

function formatCurrency(cents: number, currency: string = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'paid':
      return 'default';
    case 'in_transit':
      return 'secondary';
    case 'pending':
      return 'secondary';
    case 'failed':
      return 'destructive';
    case 'canceled':
      return 'outline';
    default:
      return 'outline';
  }
}

export function Payouts() {
  const payouts = useQuery(api.queries.listPayouts);

  if (payouts === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
        <Card>
          <div className="space-y-4 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Payouts</h1>
      <p className="text-muted-foreground">
        History of all payouts to your connected bank account.
      </p>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payout ID</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Arrival Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.map((payout) => (
              <TableRow key={payout._id}>
                <TableCell className="font-mono">
                  {payout.stripePayoutId}
                </TableCell>
                <TableCell className="font-medium">
                  {formatCurrency(payout.amount ?? 0, payout.currency || 'usd')}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(payout.status)}>
                    {payout.status.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {payout.arrivalDate
                    ? new Date(payout.arrivalDate).toLocaleDateString()
                    : '\u2014'}
                </TableCell>
              </TableRow>
            ))}
            {payouts.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8">
                  <Alert>
                    <AlertDescription className="text-center">
                      No payouts found.
                    </AlertDescription>
                  </Alert>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
