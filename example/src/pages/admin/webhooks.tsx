import { useCallback, useEffect, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAction, useQuery } from 'convex/react';

import { api } from '../../../convex/_generated/api';

type WebhookStatus = 'processed' | 'failed' | 'ignored';

function statusVariant(
  status: WebhookStatus,
): 'default' | 'destructive' | 'secondary' {
  switch (status) {
    case 'processed':
      return 'default';
    case 'failed':
      return 'destructive';
    case 'ignored':
      return 'secondary';
  }
}

function formatTimestamp(ts: number) {
  return new Date(ts).toLocaleString();
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? 'Copied!' : (label ?? 'Copy')}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Verify env button
// ---------------------------------------------------------------------------

function EnvCommandRow({
  command,
  envName,
  verifyFn,
}: {
  command: string;
  envName: 'v1' | 'v2';
  verifyFn: () => Promise<{ v1: boolean; v2: boolean }>;
}) {
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleVerify = async () => {
    setChecking(true);
    setFailed(false);
    try {
      const result = await verifyFn();
      if (result[envName]) {
        setVerified(true);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };

  const envVarName =
    envName === 'v1' ? 'STRIPE_WEBHOOK_SECRET' : 'STRIPE_WEBHOOK_SECRET_V2';

  if (verified) {
    return (
      <div className="bg-muted flex items-center gap-2 rounded-md p-3 text-sm">
        <span className="text-muted-foreground">
          <code>{envVarName}</code> is set in Convex.
        </span>
        <Badge variant="default" className="ml-auto">
          Verified
        </Badge>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="bg-muted flex items-center gap-2 rounded-md p-3 font-mono text-xs">
        <code className="flex-1 select-all overflow-x-auto">{command}</code>
        <CopyButton text={command} label="Copy" />
        <Button
          variant="outline"
          size="sm"
          onClick={handleVerify}
          disabled={checking}
        >
          {checking ? 'Checking…' : 'Verify'}
        </Button>
      </div>
      {failed && (
        <p className="text-muted-foreground text-sm">
          <code>{envVarName}</code> is not set yet. Copy the command above and
          run it in your terminal, then click Verify again.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Webhook setup card
// ---------------------------------------------------------------------------

function SetupWebhooksCard() {
  const setupWebhooks = useAction(api.actions.setupWebhooks);
  const getWebhookStatus = useAction(api.actions.getWebhookStatus);
  const verifyWebhookEnvs = useAction(api.actions.verifyWebhookEnvs);

  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [result, setResult] = useState<{
    v1: { id: string; secret: string; url: string };
    v2: {
      id: string;
      secret: string;
      url: string;
      enabledEvents: string[];
      created: boolean;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    v1: { id: string; status: string; eventCount: number } | null;
    v2: { id: string; status: string; eventCount: number } | null;
  } | null>(null);

  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;

  const checkStatus = useCallback(async () => {
    if (!siteUrl) return;
    setIsChecking(true);
    try {
      const s = await getWebhookStatus({ siteUrl });
      setStatus(s);
    } catch {
      // Non-fatal — just can't show status
    } finally {
      setIsChecking(false);
    }
  }, [siteUrl, getWebhookStatus]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleSetup = async () => {
    if (!siteUrl) {
      setError('VITE_CONVEX_SITE_URL is not set in your environment.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await setupWebhooks({ siteUrl });
      setResult(res);
      await checkStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const v1EnvCommand = result?.v1.secret
    ? `npx convex env set STRIPE_WEBHOOK_SECRET ${result.v1.secret}`
    : null;
  const v2EnvCommand = result?.v2.secret
    ? `npx convex env set STRIPE_WEBHOOK_SECRET_V2 ${result.v2.secret}`
    : null;

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Webhook Destinations</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            better-stripe needs two Stripe event destinations: a{' '}
            <strong>V1 snapshot</strong> destination for payments/subscriptions
            and a <strong>V2 thin</strong> destination for Connect account
            lifecycle events (onboarding status updates).
          </p>
        </div>
        <Button
          onClick={handleSetup}
          disabled={isLoading || !siteUrl}
          className="shrink-0"
        >
          {isLoading ? 'Setting up…' : 'Setup Webhooks'}
        </Button>
      </div>

      {/* Current status */}
      {!isChecking && status && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border-border rounded-md border p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-medium">V1 Snapshot</span>
              {status.v1 ? (
                <Badge variant="default">Active</Badge>
              ) : (
                <Badge variant="destructive">Not found</Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {status.v1
                ? `${status.v1.eventCount} events — payments, subscriptions, invoices, payouts`
                : 'Run the setup script to create this destination'}
            </p>
          </div>
          <div className="border-border rounded-md border p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-medium">V2 Thin</span>
              {status.v2 ? (
                <Badge variant="default">Active</Badge>
              ) : (
                <Badge variant="destructive">Not found</Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {status.v2
                ? `${status.v2.eventCount} events — Connect account onboarding & status`
                : 'Click "Setup V2 Events" to create this destination'}
            </p>
          </div>
        </div>
      )}
      {isChecking && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-[72px] w-full" />
          <Skeleton className="h-[72px] w-full" />
        </div>
      )}

      {!siteUrl && (
        <Alert variant="destructive">
          <AlertDescription>
            Missing <code>VITE_CONVEX_SITE_URL</code> environment variable. Add
            it to your <code>.env.local</code> file.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Result with copy-friendly secrets */}
      {result && (
        <Alert>
          <AlertDescription className="space-y-3">
            <p>Webhook destinations configured. Set these Convex environment variables:</p>
            {v1EnvCommand && (
              <EnvCommandRow
                command={v1EnvCommand}
                envName="v1"
                verifyFn={verifyWebhookEnvs}
              />
            )}
            {v2EnvCommand && (
              <EnvCommandRow
                command={v2EnvCommand}
                envName="v2"
                verifyFn={verifyWebhookEnvs}
              />
            )}
          </AlertDescription>
        </Alert>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function AdminWebhooks() {
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  const events = useQuery(api.webhookLog.list, {
    eventType: typeFilter === 'all' ? undefined : typeFilter,
    status:
      statusFilter === 'all'
        ? undefined
        : (statusFilter as 'processed' | 'failed' | 'ignored'),
  });

  if (events === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <div className="flex gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-36" />
        </div>
        <Card>
          <div className="space-y-4 p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  // Gather unique event types from the data for the filter dropdown
  const eventTypes = [...new Set(events.map((e) => e.eventType))];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Webhook Event Log</h1>

      {/* Setup Card */}
      <SetupWebhooksCard />

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="grid gap-1.5">
          <Label>Event Type</Label>
          <Select
            value={typeFilter}
            onValueChange={(v: string | null) => v && setTypeFilter(v)}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All Events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Status</Label>
          <Select
            value={statusFilter}
            onValueChange={(v: string | null) => v && setStatusFilter(v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="processed">Processed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="ignored">Ignored</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Events Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Event Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Stripe Event ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <>
                <TableRow
                  key={event._id}
                  className="cursor-pointer"
                  onClick={() =>
                    setExpandedEvent(
                      expandedEvent === event._id ? null : event._id,
                    )
                  }
                >
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {formatTimestamp(event.timestamp)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {event.eventType}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(event.status)}>
                      {event.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {event.stripeEventId}
                  </TableCell>
                </TableRow>

                {/* Expanded Payload */}
                {expandedEvent === event._id && (
                  <TableRow key={`${event._id}-payload`}>
                    <TableCell colSpan={4} className="bg-muted/30">
                      <p className="text-muted-foreground mb-2 text-xs font-medium">
                        Raw Payload
                      </p>
                      <pre className="bg-background border-border overflow-x-auto rounded-md border p-3 font-mono text-xs">
                        {event.payload ?? 'No payload'}
                      </pre>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8">
                  <Alert>
                    <AlertDescription className="text-center">
                      No webhook events match the current filters.
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
