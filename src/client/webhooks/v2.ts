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
  // SECURITY: Verify the webhook signature using async crypto.
  await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);

  // Signature verified — parse the raw body as a V2 thin event.
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
  if (relatedObject.type === "v2.core.account") {
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

  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: [
      "configuration.merchant",
      "configuration.recipient",
      "configuration.customer",
      "identity",
      "requirements",
    ],
  });
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
