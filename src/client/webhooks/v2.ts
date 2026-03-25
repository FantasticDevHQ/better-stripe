import type Stripe from 'stripe';

import { deriveAccountStatus } from '../core/accountStatus.js';
import type { V2ThinEvent } from '../types.js';
import {
  type WebhookContext,
  componentRef,
  extractIdentifiers,
} from './helpers.js';

// =============================================================================
// V2 EVENT HANDLER
// =============================================================================

export async function verifyV2Event(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Promise<V2ThinEvent> {
  // SECURITY: Verify the webhook signature using async crypto.
  await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);

  // Signature verified — parse the raw body as a V2 thin event.
  return JSON.parse(rawBody) as V2ThinEvent;
}

export async function handleV2Event(
  whCtx: WebhookContext,
  thinEvent: V2ThinEvent,
): Promise<void> {
  const { stripe, ctx, component } = whCtx;

  if (!thinEvent.type.startsWith('v2.core.account')) {
    console.info(`[better-stripe] Unhandled V2 event type: ${thinEvent.type}`);
    return;
  }

  const relatedObject = thinEvent.related_object;
  if (!relatedObject || relatedObject.type !== 'v2.core.account') {
    return;
  }

  const account = await stripe.v2.core.accounts.retrieve(relatedObject.id);
  const identity = account.identity;
  const metadata = (account.metadata ?? {}) as Record<string, string>;
  const { userId, orgId } = extractIdentifiers(metadata);
  const { onboardingStatus, missingRequirements } =
    deriveAccountStatus(account);

  // V2 Account uses contact_email at account level, individual.email in identity
  const email =
    account.contact_email ?? identity?.individual?.email ?? undefined;
  // V2 uses registered_name for business, given_name + surname for individual
  const name =
    identity?.business_details?.registered_name ??
    (identity?.individual
      ? [identity.individual.given_name, identity.individual.surname]
          .filter(Boolean)
          .join(' ') || undefined
      : undefined);

  await ctx.runMutation(
    componentRef(component, 'core/mutations/upsertAccountInternal'),
    {
      stripeAccountId: account.id,
      userId: userId || account.id,
      orgId,
      email,
      name,
      country: identity?.country ?? undefined,
      requirements: account.requirements ?? undefined,
      configuration: account.configuration ?? undefined,
      appliedConfigurations: account.applied_configurations ?? undefined,
      onboardingStatus,
      missingRequirements,
      metadata,
    },
  );
}
