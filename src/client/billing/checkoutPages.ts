import type Stripe from "stripe";
import { z } from "zod";

const time = z.number().int().nonnegative().safe();
const scopeSchema = z
  .object({
    customerAccount: z
      .string()
      .max(128)
      .regex(/^acct_[A-Za-z0-9_]+$/),
    status: z.enum(["open", "complete", "expired"]).optional(),
    created: z
      .object({ gte: time.optional(), lte: time.optional() })
      .strict()
      .optional(),
  })
  .strict();
const optionsSchema = scopeSchema
  .extend({
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(2048).nullable().optional(),
  })
  .strict();
const sessionId = z
  .string()
  .max(128)
  .regex(/^cs_[A-Za-z0-9_]+$/);
const cursorSchema = z
  .object({
    version: z.literal(1),
    scope: scopeSchema,
    after: sessionId,
  })
  .strict();
const identitySchema = z
  .object({
    id: sessionId,
    object: z.literal("checkout.session"),
    customer_account: z.string(),
    created: time,
  })
  .passthrough();

export type CheckoutSessionPageOptions = z.input<typeof optionsSchema>;
export type ProviderCheckoutSessionPage = {
  page: Stripe.Checkout.Session[];
  hasMore: boolean;
  continueCursor: string | null;
};

function encodeCursor(scope: z.infer<typeof scopeSchema>, after: string) {
  return btoa(JSON.stringify({ version: 1, scope, after }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeCursor(cursor: string, scope: z.infer<typeof scopeSchema>) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const parsed = cursorSchema.parse(
      JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/"))),
    );
    if (
      JSON.stringify(parsed.scope) !== JSON.stringify(scope) ||
      encodeCursor(parsed.scope, parsed.after) !== cursor
    )
      throw new Error();
    return parsed.after;
  } catch {
    throw new Error("Invalid Checkout page cursor or scope");
  }
}

/** Provider discovery only. Hosts authorize buyers and reconcile mutable history and gaps. */
export async function getCheckoutSessionPageFromStripe(
  stripe: Stripe,
  input: CheckoutSessionPageOptions,
): Promise<ProviderCheckoutSessionPage> {
  const { limit, cursor, ...scope } = optionsSchema.parse(input);
  if (
    scope.created?.gte !== undefined &&
    scope.created.lte !== undefined &&
    scope.created.gte > scope.created.lte
  )
    throw new Error("Invalid Checkout page time window");
  if (
    scope.created &&
    scope.created.gte === undefined &&
    scope.created.lte === undefined
  )
    delete scope.created;
  const after = cursor ? decodeCursor(cursor, scope) : undefined;
  const response = await stripe.checkout.sessions.list({
    customer_account: scope.customerAccount,
    limit,
    ...(scope.status ? { status: scope.status } : {}),
    ...(scope.created ? { created: scope.created } : {}),
    ...(after ? { starting_after: after } : {}),
  });
  if (
    !Array.isArray(response.data) ||
    typeof response.has_more !== "boolean" ||
    response.data.length > limit
  )
    throw new Error("Invalid provider Checkout page");
  const seen = new Set<string>();
  for (const row of response.data) {
    const parsed = identitySchema.safeParse(row);
    if (
      !parsed.success ||
      parsed.data.customer_account !== scope.customerAccount ||
      (scope.status !== undefined && row.status !== scope.status) ||
      (scope.created?.gte !== undefined &&
        parsed.data.created < scope.created.gte) ||
      (scope.created?.lte !== undefined &&
        parsed.data.created > scope.created.lte)
    )
      throw new Error("Invalid provider Checkout page buyer scope or identity");
    if (seen.has(row.id))
      throw new Error("Duplicate provider Checkout page entry");
    if (row.id === after)
      throw new Error("Provider Checkout page has no advancing continuation");
    seen.add(row.id);
  }
  const last = response.data[response.data.length - 1]?.id;
  if (response.has_more && !last)
    throw new Error("Provider Checkout page has no advancing continuation");
  return {
    page: response.data,
    hasMore: response.has_more,
    continueCursor: response.has_more ? encodeCursor(scope, last!) : null,
  };
}
