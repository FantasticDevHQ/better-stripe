import type Stripe from "stripe";

import type { Component } from "../helpers.js";
import type {
  RegisterRoutesConfig,
  V2ThinEvent,
  WebhookActionCtx,
} from "../types.js";
import {
  type WebhookContext,
  componentRef,
  getStripeClient,
  jsonResponse,
} from "./helpers.js";
import { runHooks, scheduleAsyncHook } from "./hooks.js";
import { processEvent } from "./processors.js";
import { handleV2Event, verifyV2Event } from "./v2.js";

// =============================================================================
// CORE WEBHOOK HANDLER
// =============================================================================

export async function handleWebhookRequest(
  ctx: WebhookActionCtx,
  request: Request,
  component: Component,
  config?: RegisterRoutesConfig,
): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse({ error: "Missing stripe-signature header" }, 400);
  }

  const body = await request.text();

  let parsedBody: Record<string, unknown>;
  try {
    parsedBody = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const eventType = (parsedBody.type as string) ?? "";
  const isV2Event = eventType.startsWith("v2.");

  const stripeSecretKey = config?.stripeSecretKey;
  const stripeApiVersion = config?.stripeApiVersion;

  if (!stripeSecretKey) {
    console.error(
      "[better-stripe] Missing stripeSecretKey in registerRoutes config",
    );
    return jsonResponse(
      { error: "Stripe component not configured: missing stripeSecretKey" },
      500,
    );
  }

  const webhookSecret = config?.webhookSecret;
  if (!webhookSecret) {
    console.error(
      "[better-stripe] Missing webhookSecret in registerRoutes config",
    );
    return jsonResponse(
      { error: "Stripe component not configured: missing webhookSecret" },
      500,
    );
  }

  const stripe = getStripeClient(stripeSecretKey, stripeApiVersion);

  const whCtx: WebhookContext = {
    ctx,
    component,
    config,
    stripe,
    webhookSecret,
  };

  if (isV2Event) {
    const v2Secret = config?.webhookSecretV2 ?? webhookSecret;
    let thinEvent: V2ThinEvent;
    try {
      thinEvent = await verifyV2Event(stripe, body, signature, v2Secret);
    } catch (error) {
      console.error("[better-stripe] V2 signature verification failed:", error);
      return jsonResponse({ error: "V2 signature verification failed" }, 400);
    }

    const eventId = thinEvent.id;
    console.info(
      `[better-stripe] ← V2 event received: ${thinEvent.type} (${eventId})`,
    );

    try {
      const dedupStatus = await ctx.runMutation(
        componentRef(component, "webhooks/mutations/insertWebhookEvent"),
        {
          stripeEventId: eventId,
          eventType: thinEvent.type,
          livemode: thinEvent.livemode,
        },
      );
      if (dedupStatus !== "inserted") {
        console.info(`[better-stripe]   ↳ deduplicated (already processed)`);
        return jsonResponse({ success: true, deduplicated: true }, 200);
      }
    } catch (error) {
      console.warn(
        `[better-stripe] Webhook ledger insert failed for ${eventId}:`,
        error,
      );
    }

    let accountId: string | null = null;
    try {
      accountId = await handleV2Event(whCtx, thinEvent);
      console.info(`[better-stripe]   ↳ processed ${thinEvent.type}`);
    } catch (error) {
      console.error(
        `[better-stripe]   ✗ sync failed for ${thinEvent.type}:`,
        error,
      );
      try {
        await ctx.runMutation(
          componentRef(component, "webhooks/mutations/markWebhookEventFailed"),
          {
            stripeEventId: eventId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      } catch {
        // Ledger updates are best-effort only.
      }
      return jsonResponse({ error: "V2 account sync failed" }, 500);
    }

    try {
      await ctx.runMutation(
        componentRef(component, "webhooks/mutations/markWebhookEventProcessed"),
        {
          stripeEventId: eventId,
        },
      );
    } catch {
      // Ledger updates are best-effort only.
    }

    // Schedule the async hook with the committed doc (never throws).
    await scheduleAsyncHook(whCtx, thinEvent.type, accountId);

    try {
      await runHooks(ctx, config, thinEvent);
    } catch (error) {
      console.error(
        `[better-stripe] Hook runner error for ${thinEvent.type}:`,
        error,
      );
    }

    return jsonResponse({ success: true }, 200);
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `[better-stripe] Webhook signature verification failed: ${msg}`,
    );
    return jsonResponse(
      { error: "Webhook signature verification failed" },
      400,
    );
  }

  // --- Atomic webhook dedup via event ledger ---
  const eventId = event.id;
  console.info(
    `[better-stripe] ← V1 event received: ${event.type} (${eventId})`,
  );

  try {
    const dedupStatus = await ctx.runMutation(
      componentRef(component, "webhooks/mutations/insertWebhookEvent"),
      {
        stripeEventId: eventId,
        eventType: event.type,
        livemode: event.livemode,
      },
    );
    if (dedupStatus !== "inserted") {
      console.info(`[better-stripe]   ↳ deduplicated (already processed)`);
      return jsonResponse({ success: true, deduplicated: true }, 200);
    }
  } catch (error) {
    // Ledger write failed — log but continue processing
    console.warn(
      `[better-stripe] Webhook ledger insert failed for ${eventId}:`,
      error,
    );
  }

  // --- Process event (sync) ---
  try {
    await processEvent(whCtx, event);
    console.info(`[better-stripe]   ↳ processed ${event.type}`);
  } catch (error) {
    console.error(`[better-stripe]   ✗ sync failed for ${event.type}:`, error);
    try {
      await ctx.runMutation(
        componentRef(component, "webhooks/mutations/markWebhookEventFailed"),
        {
          stripeEventId: eventId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    } catch {
      /* ledger update best-effort */
    }
    return jsonResponse({ error: "Sync processing failed" }, 500);
  }

  // --- Mark processed ---
  try {
    await ctx.runMutation(
      componentRef(component, "webhooks/mutations/markWebhookEventProcessed"),
      {
        stripeEventId: eventId,
      },
    );
  } catch {
    /* ledger update best-effort */
  }

  // --- Schedule the async hook with the committed doc (never throws) ---
  const objectId = (event.data.object as { id?: string }).id ?? null;
  await scheduleAsyncHook(whCtx, event.type, objectId);

  // --- Run async hooks (errors must not crash the handler) ---
  try {
    await runHooks(ctx, config, event);
  } catch (error) {
    console.error(
      `[better-stripe] Hook runner error for ${event.type}:`,
      error,
    );
  }

  return jsonResponse({ success: true }, 200);
}
