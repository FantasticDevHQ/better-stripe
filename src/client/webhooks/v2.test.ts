// @vitest-environment edge-runtime
/**
 * Tests for the V2 thin-event surface (`verifyV2Event`, `handleV2Event`).
 *
 * V2 "thin" events carry only a `related_object` pointer, not the full
 * resource, so the handler must (1) verify the signature with the thin-event
 * API — `parseEventNotificationAsync`, NEVER `constructEventAsync`, which
 * stripe-node v22 rejects for thin payloads — and (2) re-fetch the connected
 * account from Stripe to build the upsert. These tests drive every routing
 * branch (direct account ref vs. sub-resource URL parsing vs. unroutable),
 * assert the EXACT normalized payload handed to `dispatchUpsert`, and cover
 * the email/name fallbacks and the `userId || account.id` attribution rule.
 *
 * `whCtx` is built WITHOUT `config.webhooks`, so `dispatchUpsert` routes through
 * `ctx.runMutation(componentRef(component, "core/mutations/upsertAccountInternal"))`
 * — letting us read the payload straight off the runMutation mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { V2ThinEvent } from "../types.js";
import type { WebhookContext } from "./helpers.js";
import { handleV2Event, verifyV2Event } from "./v2.js";

const TO_REF = Symbol.for("toReferencePath");

/** Fake component exposing the upsertAccountInternal ref v2.ts resolves. */
function makeComponent() {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    core: {
      queries: { getAccount: ref("core/queries/getAccount") },
      mutations: {
        upsertAccountInternal: ref("core/mutations/upsertAccountInternal"),
      },
    },
  };
}

function makeCtx() {
  return {
    runQuery: vi.fn().mockResolvedValue(null),
    runMutation: vi.fn().mockResolvedValue(undefined),
  };
}

function makeStripe() {
  return {
    parseEventNotificationAsync: vi.fn(),
    v2: { core: { accounts: { retrieve: vi.fn() } } },
  };
}

function makeWhCtx(overrides?: {
  ctx?: ReturnType<typeof makeCtx>;
  stripe?: ReturnType<typeof makeStripe>;
}): WebhookContext & {
  ctx: ReturnType<typeof makeCtx>;
  stripe: ReturnType<typeof makeStripe>;
} {
  const ctx = overrides?.ctx ?? makeCtx();
  const stripe = overrides?.stripe ?? makeStripe();
  return {
    ctx,
    component: makeComponent(),
    stripe,
    webhookSecret: "whsec_test",
    // no `config.webhooks` → dispatchUpsert uses the direct component path
  } as unknown as WebhookContext & {
    ctx: ReturnType<typeof makeCtx>;
    stripe: ReturnType<typeof makeStripe>;
  };
}

function makeThinEvent(overrides?: Partial<V2ThinEvent>): V2ThinEvent {
  return {
    id: "evt_v2_1",
    type: "v2.core.account.updated",
    created: new Date().toISOString(),
    livemode: false,
    related_object: {
      id: "acct_123",
      type: "v2.core.account",
      url: "/v2/core/accounts/acct_123",
    },
    ...overrides,
  } as V2ThinEvent;
}

/** A fully-populated V2 account, business identity, complete onboarding. */
function makeAccount(overrides?: Record<string, unknown>) {
  return {
    id: "acct_123",
    contact_email: "biz@example.com",
    identity: {
      business_details: { registered_name: "Acme Inc" },
      country: "US",
    },
    metadata: { userId: "user_1" },
    requirements: {},
    configuration: { customer: { applied: true } },
    applied_configurations: ["customer"],
    ...overrides,
  };
}

/** The payload + resolved ref path from the Nth runMutation call. */
function dispatched(ctx: ReturnType<typeof makeCtx>, n = 0) {
  const call = ctx.runMutation.mock.calls[n];
  return {
    path: call[0][TO_REF] as string,
    data: call[1] as Record<string, unknown>,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("verifyV2Event", () => {
  it("verifies the signature via parseEventNotificationAsync and returns the parsed thin event", async () => {
    const stripe = makeStripe();
    stripe.parseEventNotificationAsync.mockResolvedValue({
      /* SDK EventNotification — intentionally ignored */ id: "from_sdk",
    });
    const thin = makeThinEvent({ id: "evt_raw" });
    const rawBody = JSON.stringify(thin);

    const result = await verifyV2Event(
      stripe as never,
      rawBody,
      "sig_abc",
      "whsec_v2",
    );

    expect(stripe.parseEventNotificationAsync).toHaveBeenCalledWith(
      rawBody,
      "sig_abc",
      "whsec_v2",
    );
    // Returns OUR parse of the raw body, not the SDK's EventNotification object.
    expect(result.id).toBe("evt_raw");
    expect(result).toEqual(thin);
  });

  it("rejects when signature verification fails (and never parses the body)", async () => {
    const stripe = makeStripe();
    stripe.parseEventNotificationAsync.mockRejectedValue(
      new Error("No signatures found matching the expected signature"),
    );

    await expect(
      verifyV2Event(stripe as never, "{}", "bad_sig", "whsec_v2"),
    ).rejects.toThrow(/No signatures found/);
  });
});

describe("handleV2Event — routing / early returns", () => {
  it("skips and returns null for a non-account V2 event type", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const whCtx = makeWhCtx();

    const result = await handleV2Event(
      whCtx,
      makeThinEvent({ type: "v2.money_management.financial_account.created" }),
    );

    expect(result).toBeNull();
    expect(whCtx.stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled();
    expect(whCtx.ctx.runMutation).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Unhandled V2 event type"),
    );
  });

  it("returns null when the thin event has no related_object", async () => {
    const whCtx = makeWhCtx();
    const result = await handleV2Event(
      whCtx,
      makeThinEvent({ related_object: undefined }),
    );
    expect(result).toBeNull();
    expect(whCtx.stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled();
  });

  it("returns null for a sub-resource whose URL has no parseable account id", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const whCtx = makeWhCtx();

    const result = await handleV2Event(
      whCtx,
      makeThinEvent({
        type: "v2.core.account_person.updated",
        related_object: {
          id: "bp_1",
          type: "v2.core.account_person",
          url: "/v2/core/persons/bp_1",
        },
      }),
    );

    expect(result).toBeNull();
    expect(whCtx.stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Could not extract account ID"),
    );
  });

  it("returns null for a sub-resource with neither matching type nor URL", async () => {
    const whCtx = makeWhCtx();
    const result = await handleV2Event(
      whCtx,
      makeThinEvent({
        related_object: {
          id: "bp_1",
          type: "v2.core.account_person",
          // no url
        } as never,
      }),
    );
    expect(result).toBeNull();
    expect(whCtx.stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled();
  });

  it("parses the account id out of a sub-resource URL and retrieves that account", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue(
      makeAccount({ id: "acct_fromurl" }),
    );
    const whCtx = makeWhCtx({ stripe });

    const result = await handleV2Event(
      whCtx,
      makeThinEvent({
        type: "v2.core.account_person.updated",
        related_object: {
          id: "bp_1",
          type: "v2.core.account_person",
          url: "/v2/core/accounts/acct_fromurl/persons/bp_1",
        },
      }),
    );

    expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledWith(
      "acct_fromurl",
      expect.objectContaining({ include: expect.any(Array) }),
    );
    expect(result).toBe("acct_fromurl");
  });
});

describe("handleV2Event — account sync payload", () => {
  it("retrieves the account with the documented include list and dispatches a normalized upsert", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue(makeAccount());
    const whCtx = makeWhCtx({ stripe });

    const result = await handleV2Event(whCtx, makeThinEvent());

    expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledWith("acct_123", {
      include: [
        "configuration.merchant",
        "configuration.recipient",
        "configuration.customer",
        "identity",
        "requirements",
      ],
    });

    const { path, data } = dispatched(whCtx.ctx);
    expect(path).toBe("betterStripe/core/mutations/upsertAccountInternal");
    expect(data).toMatchObject({
      stripeAccountId: "acct_123",
      userId: "user_1",
      email: "biz@example.com",
      name: "Acme Inc",
      country: "US",
      onboardingStatus: "complete",
      missingRequirements: [],
      metadata: { userId: "user_1" },
    });
    expect(result).toBe("acct_123");
  });

  it("falls back to the account id as userId when metadata carries no user attribution", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue(
      makeAccount({ metadata: {} }),
    );
    const whCtx = makeWhCtx({ stripe });

    await handleV2Event(whCtx, makeThinEvent());

    // extractIdentifiers returns "" → `userId || account.id` picks the id.
    expect(dispatched(whCtx.ctx).data.userId).toBe("acct_123");
  });

  it("derives email and name from individual identity when business details are absent", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue(
      makeAccount({
        contact_email: null,
        identity: {
          country: "GB",
          individual: {
            email: "jane@example.com",
            given_name: "Jane",
            surname: "Doe",
          },
        },
      }),
    );
    const whCtx = makeWhCtx({ stripe });

    await handleV2Event(whCtx, makeThinEvent());

    const { data } = dispatched(whCtx.ctx);
    expect(data.email).toBe("jane@example.com");
    expect(data.name).toBe("Jane Doe");
    expect(data.country).toBe("GB");
  });

  it("leaves name undefined when an individual identity has no name parts", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue(
      makeAccount({
        contact_email: "only@example.com",
        identity: { country: "US", individual: {} },
      }),
    );
    const whCtx = makeWhCtx({ stripe });

    await handleV2Event(whCtx, makeThinEvent());

    expect(dispatched(whCtx.ctx).data.name).toBeUndefined();
  });

  it("leaves email/name/country undefined when the account carries no identity", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue(
      makeAccount({ contact_email: null, identity: null }),
    );
    const whCtx = makeWhCtx({ stripe });

    await handleV2Event(whCtx, makeThinEvent());

    const { data } = dispatched(whCtx.ctx);
    expect(data.email).toBeUndefined();
    expect(data.name).toBeUndefined();
    expect(data.country).toBeUndefined();
  });

  it("propagates a derived restricted status and the missing-requirements list", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue(
      makeAccount({
        requirements: {
          entries: [{ description: "tos_acceptance" }],
          summary: { minimum_deadline: { status: "past_due" } },
        },
        configuration: {},
      }),
    );
    const whCtx = makeWhCtx({ stripe });

    await handleV2Event(whCtx, makeThinEvent());

    const { data } = dispatched(whCtx.ctx);
    expect(data.onboardingStatus).toBe("restricted");
    expect(data.missingRequirements).toEqual(["tos_acceptance"]);
  });

  it("defaults metadata to an empty object when the account has none", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue(
      makeAccount({ metadata: undefined }),
    );
    const whCtx = makeWhCtx({ stripe });

    await handleV2Event(whCtx, makeThinEvent());

    expect(dispatched(whCtx.ctx).data.metadata).toEqual({});
  });

  it("propagates a Stripe retrieve failure to the caller (handler marks the ledger failed)", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockRejectedValue(
      new Error("Stripe API down"),
    );
    const whCtx = makeWhCtx({ stripe });

    await expect(handleV2Event(whCtx, makeThinEvent())).rejects.toThrow(
      /Stripe API down/,
    );
    expect(whCtx.ctx.runMutation).not.toHaveBeenCalled();
  });
});
