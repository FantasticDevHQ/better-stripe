import { STRIPE_CUSTOMER_PREVIEW_API_VERSION } from "../apiVersion.js";
import type Stripe from "stripe";

import { deriveAccountStatus } from "../core/accountStatus.js";
import type { V2ThinEvent } from "../types.js";
import {
  type WebhookContext,
  dispatchUpsert,
  extractIdentifiers,
} from "./helpers.js";

// =============================================================================
// V2 EVENT HANDLER
// =============================================================================

export async function verifyV2Event(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Promise<V2ThinEvent> {
  // SECURITY: Verify the webhook signature using async crypto via the
  // thin-event API. stripe-node v22+ rejects thin payloads passed to
  // `webhooks.constructEventAsync` ("Use stripe.parseEventNotificationAsync
  // instead"), so this is the only verification path that works for V2
  // events. It also rejects V1 snapshot payloads, which can't reach here
  // (the handler routes by event type prefix).
  await stripe.parseEventNotificationAsync(rawBody, signature, webhookSecret);

  // Signature verified — return our own parse of the raw body. The SDK's
  // EventNotification return value mutates `context` into a StripeContext
  // object and attaches fetchEvent()/fetchRelatedObject() closures, which
  // doesn't match the plain-data V2ThinEvent contract (context?: string).
  return JSON.parse(rawBody) as V2ThinEvent;
}

/**
 * Process a V2 thin event by syncing the connected account.
 * Returns the upserted account's Stripe id, or null when the event
 * was skipped (unhandled type, missing related object, etc.).
 */
export async function handleV2Event(
  whCtx: WebhookContext,
  thinEvent: V2ThinEvent,
): Promise<string | null> {
  const { stripe } = whCtx;

  if (!thinEvent.type.startsWith("v2.core.account")) {
    console.info(`[better-stripe] Unhandled V2 event type: ${thinEvent.type}`);
    return null;
  }

  const relatedObject = thinEvent.related_object;
  if (!relatedObject) {
    return null;
  }

  // Extract the account ID — related_object may reference the account directly
  // (type: 'v2.core.account') or a sub-resource (type: 'v2.core.account_person').
  // For sub-resources, parse the account ID from the URL (/v2/core/accounts/acct_xxx/...).
  let accountId: string;
  if (relatedObject.type === "v2.core.account" && relatedObject.id) {
    accountId = relatedObject.id;
  } else if (relatedObject.url) {
    const match = relatedObject.url.match(/\/accounts\/(acct_[a-zA-Z0-9]+)/);
    if (match) {
      accountId = match[1];
    } else {
      console.info(
        `[better-stripe] Could not extract account ID from V2 event: ${thinEvent.type}`,
      );
      return null;
    }
  } else {
    return null;
  }

  const retrieveParams: NonNullable<
    Parameters<Stripe["v2"]["core"]["accounts"]["retrieve"]>[1]
  > = {
    include:
      whCtx.config?.stripeApiVersion === STRIPE_CUSTOMER_PREVIEW_API_VERSION
        ? ["configuration.customer", "identity"]
        : [
            "configuration.merchant",
            "configuration.recipient",
            "configuration.customer",
            "identity",
            "requirements",
          ],
  };
  // Preserve the verified notification's account/organization context when
  // fetching the latest resource; otherwise organization keys can fetch from
  // the wrong account. Keep the raw string in the public thin-event payload.
  const account = thinEvent.context
    ? await stripe.v2.core.accounts.retrieve(accountId, retrieveParams, {
        stripeContext: thinEvent.context,
      })
    : await stripe.v2.core.accounts.retrieve(accountId, retrieveParams);
  const identity = account.identity;
  const metadata = (account.metadata ?? {}) as Record<string, string>;
  const { userId, orgId } = extractIdentifiers(metadata);
  const { onboardingStatus, missingRequirements } =
    deriveAccountStatus(account);

  console.info(
    `[better-stripe]   ↳ account ${accountId}: status=${onboardingStatus}, missing=${missingRequirements.length}, configs=${(account.applied_configurations ?? []).join(",")}`,
  );

  // V2 Account uses contact_email at account level, individual.email in identity
  const email =
    account.contact_email ?? identity?.individual?.email ?? undefined;
  // V2 uses registered_name for business, given_name + surname for individual
  const name =
    identity?.business_details?.registered_name ??
    (identity?.individual
      ? [identity.individual.given_name, identity.individual.surname]
          .filter(Boolean)
          .join(" ") || undefined
      : undefined);

  await dispatchUpsert(whCtx, "accountUpserted", {
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
  });

  return account.id;
}
