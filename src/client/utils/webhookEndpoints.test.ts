/**
 * Tests for webhook-endpoint and V2 event-destination registration helpers.
 *
 * These functions are the install-time glue that wires Stripe -> better-stripe.
 * The interesting behavior is all in *which* Stripe call gets made and with
 * *what* params: list -> map to a trimmed summary shape; create-after-dedup
 * (delete the existing same-URL endpoint first because the signing secret is
 * only returned on create); and the V2 setup function's create-vs-update
 * decision keyed on (url, payload type), its re-enable-if-disabled branch, and
 * its thin/snapshot defaulting of name/description/events/events_from.
 *
 * We mock only the Stripe slice each function touches and assert on the exact
 * arguments forwarded and the decisions taken.
 */
import { describe, expect, it, vi } from "vitest";

import type { RunCtx } from "../helpers.js";
import {
  ALL_BETTER_STRIPE_EVENTS,
  BETTER_STRIPE_V2_WEBHOOK_EVENTS,
  BETTER_STRIPE_WEBHOOK_EVENTS,
  createWebhookEndpoint,
  listEventDestinations,
  listWebhookEndpoints,
  setupEventDestination,
} from "./webhookEndpoints.js";

function makeStripe() {
  return {
    webhookEndpoints: {
      list: vi.fn(),
      create: vi.fn(),
      del: vi.fn(),
    },
    v2: {
      core: {
        eventDestinations: {
          list: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          enable: vi.fn(),
        },
      },
    },
  };
}

const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof listWebhookEndpoints>[0];

const ctx = {} as RunCtx;

describe("event constant exports", () => {
  it("ALL_BETTER_STRIPE_EVENTS is the concatenation of V1 then V2 events", () => {
    expect(ALL_BETTER_STRIPE_EVENTS).toEqual([
      ...BETTER_STRIPE_WEBHOOK_EVENTS,
      ...BETTER_STRIPE_V2_WEBHOOK_EVENTS,
    ]);
    // sanity: includes a representative V1 and V2 event
    expect(ALL_BETTER_STRIPE_EVENTS).toContain("invoice.paid");
    expect(ALL_BETTER_STRIPE_EVENTS).toContain("v2.core.account.updated");
  });
});

describe("listWebhookEndpoints", () => {
  it("passes the default limit of 100 and maps endpoints to the summary shape", async () => {
    const stripe = makeStripe();
    stripe.webhookEndpoints.list.mockResolvedValue({
      data: [
        {
          id: "we_1",
          url: "https://a.example/hook",
          status: "enabled",
          enabled_events: ["invoice.paid"],
          description: "primary",
          livemode: true,
        },
      ],
    });

    const result = await listWebhookEndpoints(asStripe(stripe), ctx);

    expect(stripe.webhookEndpoints.list).toHaveBeenCalledWith({ limit: 100 });
    expect(result).toEqual([
      {
        id: "we_1",
        url: "https://a.example/hook",
        status: "enabled",
        enabledEvents: ["invoice.paid"],
        description: "primary",
        livemode: true,
      },
    ]);
  });

  it("forwards a caller-supplied limit and maps a null description to undefined", async () => {
    const stripe = makeStripe();
    stripe.webhookEndpoints.list.mockResolvedValue({
      data: [
        {
          id: "we_2",
          url: "https://b.example/hook",
          status: "disabled",
          enabled_events: [],
          description: null,
          livemode: false,
        },
      ],
    });

    const result = await listWebhookEndpoints(asStripe(stripe), ctx, {
      limit: 5,
    });

    expect(stripe.webhookEndpoints.list).toHaveBeenCalledWith({ limit: 5 });
    expect(result[0].description).toBeUndefined();
    expect(result[0].status).toBe("disabled");
  });
});

describe("createWebhookEndpoint", () => {
  it("deletes a pre-existing same-URL endpoint, then creates with default events and description", async () => {
    const stripe = makeStripe();
    stripe.webhookEndpoints.list.mockResolvedValue({
      data: [
        { id: "we_old", url: "https://app.example/stripe" },
        { id: "we_other", url: "https://other.example/stripe" },
      ],
    });
    stripe.webhookEndpoints.create.mockResolvedValue({
      id: "we_new",
      secret: "whsec_abc",
      url: "https://app.example/stripe",
    });

    const result = await createWebhookEndpoint(asStripe(stripe), ctx, {
      url: "https://app.example/stripe",
    });

    // dedup: only the matching URL is deleted
    expect(stripe.webhookEndpoints.del).toHaveBeenCalledTimes(1);
    expect(stripe.webhookEndpoints.del).toHaveBeenCalledWith("we_old");

    const createArg = stripe.webhookEndpoints.create.mock.calls[0][0];
    expect(createArg.url).toBe("https://app.example/stripe");
    expect(createArg.enabled_events).toEqual(BETTER_STRIPE_WEBHOOK_EVENTS);
    expect(createArg.description).toBe(
      "Created by better-stripe createWebhookEndpoint",
    );

    expect(result).toEqual({
      id: "we_new",
      secret: "whsec_abc",
      url: "https://app.example/stripe",
    });
  });

  it("does not delete anything when no existing endpoint matches the URL", async () => {
    const stripe = makeStripe();
    stripe.webhookEndpoints.list.mockResolvedValue({
      data: [{ id: "we_x", url: "https://different.example/stripe" }],
    });
    stripe.webhookEndpoints.create.mockResolvedValue({
      id: "we_new",
      secret: "whsec_xyz",
      url: "https://app.example/stripe",
    });

    await createWebhookEndpoint(asStripe(stripe), ctx, {
      url: "https://app.example/stripe",
      enabledEvents: ["invoice.paid", "product.created"],
      description: "custom",
    });

    expect(stripe.webhookEndpoints.del).not.toHaveBeenCalled();
    const createArg = stripe.webhookEndpoints.create.mock.calls[0][0];
    // caller-supplied events + description override the defaults
    expect(createArg.enabled_events).toEqual([
      "invoice.paid",
      "product.created",
    ]);
    expect(createArg.description).toBe("custom");
  });
});

describe("listEventDestinations", () => {
  it("requests the webhook url include, passes default limit 100, and maps the summary shape", async () => {
    const stripe = makeStripe();
    stripe.v2.core.eventDestinations.list.mockResolvedValue({
      data: [
        {
          id: "ed_1",
          webhook_endpoint: { url: "https://app.example/v2" },
          status: "enabled",
          enabled_events: ["v2.core.account.updated"],
          event_payload: "thin",
          name: "better-stripe-v2",
          description: "desc",
        },
      ],
    });

    const result = await listEventDestinations(asStripe(stripe), ctx);

    expect(stripe.v2.core.eventDestinations.list).toHaveBeenCalledWith({
      limit: 100,
      include: ["webhook_endpoint.url"],
    });
    expect(result).toEqual([
      {
        id: "ed_1",
        url: "https://app.example/v2",
        status: "enabled",
        enabledEvents: ["v2.core.account.updated"],
        eventPayload: "thin",
        name: "better-stripe-v2",
        description: "desc",
      },
    ]);
  });

  it("falls back to an empty url string when the destination has no webhook_endpoint", async () => {
    const stripe = makeStripe();
    stripe.v2.core.eventDestinations.list.mockResolvedValue({
      data: [
        {
          id: "ed_2",
          webhook_endpoint: null,
          status: "disabled",
          enabled_events: [],
          event_payload: "snapshot",
          name: "n",
          description: "d",
        },
      ],
    });

    const result = await listEventDestinations(asStripe(stripe), ctx, {
      limit: 3,
    });

    expect(stripe.v2.core.eventDestinations.list).toHaveBeenCalledWith({
      limit: 3,
      include: ["webhook_endpoint.url"],
    });
    expect(result[0].url).toBe("");
  });
});

describe("setupEventDestination", () => {
  it("creates a thin destination by default with V2 events, thin defaults, and self+other_accounts source", async () => {
    const stripe = makeStripe();
    stripe.v2.core.eventDestinations.list.mockResolvedValue({ data: [] });
    stripe.v2.core.eventDestinations.create.mockResolvedValue({
      id: "ed_new",
      webhook_endpoint: { signing_secret: "whsec_thin" },
      enabled_events: [...BETTER_STRIPE_V2_WEBHOOK_EVENTS],
    });

    const result = await setupEventDestination(asStripe(stripe), ctx, {
      url: "https://app.example/v2",
    });

    const createArg = stripe.v2.core.eventDestinations.create.mock.calls[0][0];
    expect(createArg).toMatchObject({
      name: "better-stripe-v2",
      description: "better-stripe V2 Connect account events",
      type: "webhook_endpoint",
      event_payload: "thin",
      enabled_events: [...BETTER_STRIPE_V2_WEBHOOK_EVENTS],
      events_from: ["self", "other_accounts"],
      webhook_endpoint: { url: "https://app.example/v2" },
      include: ["webhook_endpoint.signing_secret", "webhook_endpoint.url"],
    });

    expect(result).toEqual({
      id: "ed_new",
      secret: "whsec_thin",
      url: "https://app.example/v2",
      enabledEvents: [...BETTER_STRIPE_V2_WEBHOOK_EVENTS],
      created: true,
    });
  });

  it("creates a snapshot destination with V1 events, snapshot defaults, and self-only source", async () => {
    const stripe = makeStripe();
    stripe.v2.core.eventDestinations.list.mockResolvedValue({ data: [] });
    stripe.v2.core.eventDestinations.create.mockResolvedValue({
      id: "ed_snap",
      webhook_endpoint: { signing_secret: "whsec_snap" },
      enabled_events: [...BETTER_STRIPE_WEBHOOK_EVENTS],
    });

    await setupEventDestination(asStripe(stripe), ctx, {
      url: "https://app.example/v1",
      eventPayload: "snapshot",
    });

    const createArg = stripe.v2.core.eventDestinations.create.mock.calls[0][0];
    expect(createArg.name).toBe("better-stripe");
    expect(createArg.description).toBe("better-stripe V1 payment events");
    expect(createArg.event_payload).toBe("snapshot");
    expect(createArg.enabled_events).toEqual([...BETTER_STRIPE_WEBHOOK_EVENTS]);
    expect(createArg.events_from).toEqual(["self"]);
  });

  it("honors caller-supplied name/description/enabledEvents on create", async () => {
    const stripe = makeStripe();
    stripe.v2.core.eventDestinations.list.mockResolvedValue({ data: [] });
    stripe.v2.core.eventDestinations.create.mockResolvedValue({
      id: "ed_custom",
      webhook_endpoint: { signing_secret: "whsec_custom" },
      enabled_events: ["v2.core.account.created"],
    });

    await setupEventDestination(asStripe(stripe), ctx, {
      url: "https://app.example/v2",
      name: "my-dest",
      description: "my description",
      enabledEvents: ["v2.core.account.created"],
    });

    const createArg = stripe.v2.core.eventDestinations.create.mock.calls[0][0];
    expect(createArg.name).toBe("my-dest");
    expect(createArg.description).toBe("my description");
    expect(createArg.enabled_events).toEqual(["v2.core.account.created"]);
  });

  it("returns an empty secret string when create omits the signing secret", async () => {
    const stripe = makeStripe();
    stripe.v2.core.eventDestinations.list.mockResolvedValue({ data: [] });
    stripe.v2.core.eventDestinations.create.mockResolvedValue({
      id: "ed_nosecret",
      webhook_endpoint: {},
      enabled_events: [],
    });

    const result = await setupEventDestination(asStripe(stripe), ctx, {
      url: "https://app.example/v2",
    });

    expect(result.secret).toBe("");
  });

  it("updates an existing destination matching the same url AND payload type instead of creating", async () => {
    const stripe = makeStripe();
    stripe.v2.core.eventDestinations.list.mockResolvedValue({
      data: [
        {
          id: "ed_match",
          webhook_endpoint: {
            url: "https://app.example/v2",
            signing_secret: "whsec_existing",
          },
          event_payload: "thin",
        },
        {
          // same URL but wrong payload type → must NOT match
          id: "ed_wrongpayload",
          webhook_endpoint: { url: "https://app.example/v2" },
          event_payload: "snapshot",
        },
      ],
    });
    stripe.v2.core.eventDestinations.update.mockResolvedValue({
      id: "ed_match",
      status: "enabled",
      enabled_events: [...BETTER_STRIPE_V2_WEBHOOK_EVENTS],
    });

    const result = await setupEventDestination(asStripe(stripe), ctx, {
      url: "https://app.example/v2",
    });

    expect(stripe.v2.core.eventDestinations.create).not.toHaveBeenCalled();
    expect(stripe.v2.core.eventDestinations.update).toHaveBeenCalledWith(
      "ed_match",
      {
        name: "better-stripe-v2",
        description: "better-stripe V2 Connect account events",
        enabled_events: [...BETTER_STRIPE_V2_WEBHOOK_EVENTS],
        include: ["webhook_endpoint.url"],
      },
    );
    // secret comes from the matched destination's existing signing secret
    expect(result).toEqual({
      id: "ed_match",
      secret: "whsec_existing",
      url: "https://app.example/v2",
      enabledEvents: [...BETTER_STRIPE_V2_WEBHOOK_EVENTS],
      created: false,
    });
    // not enabled because update already reports status "enabled"
    expect(stripe.v2.core.eventDestinations.enable).not.toHaveBeenCalled();
  });

  it("re-enables a matched destination that comes back disabled after update", async () => {
    const stripe = makeStripe();
    stripe.v2.core.eventDestinations.list.mockResolvedValue({
      data: [
        {
          id: "ed_disabled",
          webhook_endpoint: { url: "https://app.example/v2" },
          event_payload: "thin",
        },
      ],
    });
    stripe.v2.core.eventDestinations.update.mockResolvedValue({
      id: "ed_disabled",
      status: "disabled",
      enabled_events: [...BETTER_STRIPE_V2_WEBHOOK_EVENTS],
    });

    const result = await setupEventDestination(asStripe(stripe), ctx, {
      url: "https://app.example/v2",
    });

    expect(stripe.v2.core.eventDestinations.enable).toHaveBeenCalledWith(
      "ed_disabled",
    );
    // no signing_secret on the matched endpoint → empty secret fallback
    expect(result.secret).toBe("");
    expect(result.created).toBe(false);
  });

  it("creates (does not update) when the same URL exists only under a different payload type", async () => {
    const stripe = makeStripe();
    stripe.v2.core.eventDestinations.list.mockResolvedValue({
      data: [
        {
          id: "ed_snapshot",
          webhook_endpoint: { url: "https://app.example/shared" },
          event_payload: "snapshot",
        },
      ],
    });
    stripe.v2.core.eventDestinations.create.mockResolvedValue({
      id: "ed_thin_new",
      webhook_endpoint: { signing_secret: "whsec_new" },
      enabled_events: [...BETTER_STRIPE_V2_WEBHOOK_EVENTS],
    });

    const result = await setupEventDestination(asStripe(stripe), ctx, {
      url: "https://app.example/shared",
      eventPayload: "thin",
    });

    expect(stripe.v2.core.eventDestinations.update).not.toHaveBeenCalled();
    expect(stripe.v2.core.eventDestinations.create).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(true);
  });
});
