import { vi } from "vitest";
import { input } from "../../../../../../tests/renewalAggregate/rawRetention.js";
import { installReadRejection } from "./stockHttp.js";

/** TEST-only fixed Source bindings, declared before importing the actual singleton. */
export async function ownedReadFailureFixture() {
  const api = await import("../../../renewalV2/index.js");
  const preparation: Parameters<
    typeof api.prepareRenewalPriceReplacementV2
  >[0] = input();
  const prepared = await api.prepareRenewalPriceReplacementV2(preparation);
  const firstDispatchedAt = prepared.expected.periodStart + 1;
  const request = await api.prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: "2026-09-30.endive",
    attachKey: "attach:owned-wire-test",
    firstDispatchedAt,
  });
  const wallMs = firstDispatchedAt * 1000,
    ns = BigInt(wallMs) * 1_000_000n;
  const source = Object.freeze({
    clock: Object.freeze({
      basis: Object.freeze({
        startWallMs: wallMs,
        startNs: ns,
        workEndWallMs: wallMs + 180000,
        workEndNs: ns + 180000000000n,
        endWallMs: wallMs + 210000,
        endNs: ns + 210000000000n,
      }),
      sample: () => ({ wallMs, ns }),
      subscribeRetirement: () => () => {},
    }),
    originalPolicy: Object.freeze({
      firstDispatchedAt,
      periodStart: prepared.expected.periodStart,
      periodEnd: prepared.expected.periodEnd,
    }),
    originAssociation: Object.freeze({}),
  });
  const query = String(
    new URLSearchParams(
      ["discounts", "items.data.discounts", "items.data.price"].map((v, i) => [
        "expand[" + i + "]",
        v,
      ]),
    ),
  );
  const path =
    "/v1/subscriptions/" + prepared.expected.subscriptionId + "?" + query;
  const http = installReadRejection("https://api.stripe.com" + path);
  const { getStripeClient } = await import("../../../../helpers.js");
  const client = getStripeClient("sk_test_owned_wire", "2026-09-30.endive", {
    singleAttempt: true,
  });
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => source,
    loadFixedStockClient: () => client,
  }));
  const { OWNER } = await import("../originalOwner.js");
  const { createSourceStockRawDelegate } =
    await import("../stockRawDelegate.js");
  const delegate = createSourceStockRawDelegate();
  const readPlan = [
    { resource: "subscription", path },
    {
      resource: "price",
      path: "/v1/prices/" + prepared.expected.targetPriceId,
    },
    {
      resource: "customer",
      path: "/v1/customers/" + prepared.providerSnapshot.billingCustomer!.id,
    },
  ].map((row, i) => ({
    ...row,
    ordinal: i + 1,
    method: "GET",
    body: undefined,
    options: { apiVersion: "2026-09-30.endive", maxNetworkRetries: 0 },
  }));
  const transportSource = Object.freeze({
    owner: OWNER,
    request,
    readPlan,
    delegate,
  });
  vi.doMock("../operations/sourceOperations.js", () => ({
    loadOwnedTransportSource: () => transportSource,
  }));
  const { createOwnedTransportWithAttemptCapability } =
    await import("../operations/fixedTransport.js");
  const pair = createOwnedTransportWithAttemptCapability();
  return { prepared, request, OWNER, pair, http, source };
}
