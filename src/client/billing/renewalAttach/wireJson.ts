import { z } from "zod";
import type Stripe from "stripe";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { resourceId, unsupported } from "../renewalAggregate/shared.js";

const resources = {
  subscription: { path: "subscriptions", id: resourceId("sub") },
  price: { path: "prices", id: resourceId("price") },
  customer: { path: "customers", id: resourceId("cus") },
  coupon: {
    path: "coupons",
    id: z
      .string()
      .min(1)
      .max(255)
      .regex(/\S/)
      .refine(
        (value) => value !== "." && value !== "..",
        "Coupon ID must not be a URL dot segment.",
      ),
  },
} as const;
const expansions = ["discounts", "items.data.discounts", "items.data.price"];

/** Fixed renewal GETs only. rawRequest bypasses typed resource Decimal coercion. */
export async function readRenewalWireJSON(
  stripe: Stripe,
  resource: keyof typeof resources,
  id: string,
) {
  const spec = resources[resource];
  const selectedId = spec.id.parse(id);
  const query =
    resource === "subscription"
      ? `?${new URLSearchParams(expansions.map((value, i) => [`expand[${i}]`, value]))}`
      : "";
  const reply: unknown = await stripe.rawRequest(
    "GET",
    `/v1/${spec.path}/${encodeURIComponent(selectedId)}${query}`,
    undefined,
    { apiVersion: "2026-09-30.endive", maxNetworkRetries: 0 },
  );
  if (!reply || typeof reply !== "object")
    unsupported("missing_provider_http_status");
  const descriptor = Object.getOwnPropertyDescriptor(reply, "lastResponse");
  if (
    !descriptor ||
    descriptor.enumerable ||
    !("value" in descriptor) ||
    !descriptor.value ||
    typeof descriptor.value !== "object"
  )
    unsupported("missing_provider_http_status");
  // Fetch's public Response uses status; Node IncomingMessage uses statusCode.
  // Neither is provider JSON. If both are present they must agree.
  const meta = descriptor.value as { status?: unknown; statusCode?: unknown };
  const codes = [meta.status, meta.statusCode].filter(
    (code) => code !== undefined,
  );
  if (
    !codes.length ||
    codes.some(
      (code) =>
        typeof code !== "number" ||
        !Number.isInteger(code) ||
        code < 200 ||
        code >= 300,
    ) ||
    codes.some((code) => code !== codes[0])
  )
    unsupported("unverified_provider_http_status");
  // Strict JSON copy remains unchanged. Nonenumerable transport metadata is
  // excluded; every enumerable wire-body fact, including unknown fields, remains.
  return renewalSnapshot(reply);
}
