import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/providers/role-context';
import {
  AccountOnboardingCard,
  ConnectRequirements,
  ConnectStatusBadge,
} from '@getdojo/better-stripe/react';
import { useAction, useQuery } from 'convex/react';
import { HelpCircle, RotateCcw } from 'lucide-react';

import { api } from '../../../convex/_generated/api';

/** Stripe-supported test countries for Connect. */
const CONNECT_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'CA', name: 'Canada' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' },
  { code: 'SG', name: 'Singapore' },
];

export function Onboarding() {
  const { currentUser } = useRole();
  const account = useQuery(api.queries.getAccountByUserId, {
    userId: currentUser.id,
  });
  const createAccountWithOnboarding = useAction(
    api.actions.createAccountWithOnboarding,
  );
  const getAccountLink = useAction(api.actions.getAccountLinkWithStatus);
  const restartOnboarding = useAction(api.actions.restartAccountOnboarding);
  const [isCreating, setIsCreating] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState('US');

  if (account === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // No account yet — show account creation with country selector
  if (account === null) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Creator Onboarding</h1>
        <p className="text-muted-foreground">
          Create a Stripe Connect account to start receiving payouts for your
          courses.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Get Started with Payouts</CardTitle>
            <CardDescription>
              Select your country and create a Stripe Connect account. You'll be
              redirected to Stripe to complete identity verification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>Country</Label>
              <Select
                value={selectedCountry}
                onValueChange={(v: string | null) => v && setSelectedCountry(v)}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {CONNECT_COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={async () => {
                setIsCreating(true);
                try {
                  const result = await createAccountWithOnboarding({
                    userId: currentUser.id,
                    email: currentUser.email,
                    country: selectedCountry,
                    refreshUrl: window.location.href,
                    returnUrl: window.location.origin + '/creator/onboarding',
                  });
                  if (result.onboardingUrl) {
                    window.location.href = result.onboardingUrl;
                  }
                } catch (err) {
                  console.error('Failed to create account:', err);
                } finally {
                  setIsCreating(false);
                }
              }}
              disabled={isCreating || !selectedCountry}
            >
              {isCreating ? 'Creating account...' : 'Get started'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const onboardingStatus = account.onboardingStatus ?? 'pending';
  const missingRequirements = account.missingRequirements ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Creator Onboarding</h1>
        <ConnectStatusBadge status={onboardingStatus} />
      </div>

      <p className="text-muted-foreground">
        Complete the steps below to activate payouts on your account. Stripe
        requires identity verification and banking details before funds can be
        transferred.
      </p>

      {/* Step-by-step onboarding flow */}
      {onboardingStatus !== 'complete' && (
        <AccountOnboardingCard
          title="Set Up Your Stripe Account"
          description="Follow the steps to verify your identity and connect your bank account."
          onStartOnboarding={async () => {
            setIsLinking(true);
            try {
              const result = await getAccountLink({
                stripeAccountId: account.stripeAccountId,
                refreshUrl: window.location.href,
                returnUrl: window.location.origin + '/creator',
              });
              if (result.url) {
                window.location.href = result.url;
              }
            } catch (err) {
              console.error('Failed to get onboarding link:', err);
            } finally {
              setIsLinking(false);
            }
          }}
          isLoading={isLinking}
        />
      )}

      {/* Missing requirements checklist */}
      {missingRequirements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Outstanding Requirements</CardTitle>
          </CardHeader>
          <div className="px-6 pb-6">
            <ConnectRequirements requirements={missingRequirements} />
          </div>
        </Card>
      )}

      {/* Restart onboarding */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Start Over
          </CardTitle>
          <CardDescription>
            Close this Stripe account and start the onboarding process from
            scratch. This action is irreversible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={async () => {
              setIsRestarting(true);
              try {
                await restartOnboarding({
                  stripeAccountId: account.stripeAccountId,
                });
              } catch (err) {
                console.error('Failed to restart onboarding:', err);
              } finally {
                setIsRestarting(false);
              }
            }}
            disabled={isRestarting}
          >
            {isRestarting ? 'Closing account...' : 'Close account & start over'}
          </Button>
        </CardContent>
      </Card>

      {/* Help text */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            Need Help?
          </CardTitle>
          <CardDescription>
            If you're having trouble completing onboarding, ensure your
            documents are clear and match the name on your account. Verification
            usually completes within a few minutes but may take up to 48 hours.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
