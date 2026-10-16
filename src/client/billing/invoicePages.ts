import type Stripe from "stripe";
import { z } from "zod";

const time = z.number().int().nonnegative().safe();
const scopeSchema = z
  .object({
    customerAccount: z
      .string()
      .max(128)
      .regex(/^acct_[A-Za-z0-9_]+$/),
    status: z
      .enum(["draft", "open", "paid", "uncollectible", "void"])
      .optional(),
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
const cursorSchema = z
  .object({
    version: z.literal(1),
    scope: scopeSchema,
    after: z
      .string()
      .max(128)
      .regex(/^in_[A-Za-z0-9_]+$/),
  })
  .strict();

export type InvoicePageOptions = z.input<typeof optionsSchema>;
export type ProviderInvoicePage = {
  page: Stripe.Invoice[];
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
    throw new Error("Invalid invoice page cursor or scope");
  }
}

/** Provider enumeration only. The host authorizes the buyer and reconciles mutable history. */
export async function getInvoicePageFromStripe(
  stripe: Stripe,
  input: InvoicePageOptions,
): Promise<ProviderInvoicePage> {
  const { limit, cursor, ...scope } = optionsSchema.parse(input);
  if (
    scope.created?.gte !== undefined &&
    scope.created.lte !== undefined &&
    scope.created.gte > scope.created.lte
  )
    throw new Error("Invalid invoice page time window");
  if (
    scope.created &&
    scope.created.gte === undefined &&
    scope.created.lte === undefined
  )
    delete scope.created;
  const after = cursor ? decodeCursor(cursor, scope) : undefined;
  const response = await stripe.invoices.list({
    customer_account: scope.customerAccount,
    limit,
    ...(scope.status ? { status: scope.status } : {}),
    ...(scope.created ? { created: scope.created } : {}),
    ...(after ? { starting_after: after } : {}),
  });
  if (
    response.data.length > limit ||
    response.data.some(
      (invoice) =>
        invoice.customer_account !== scope.customerAccount ||
        !/^in_[A-Za-z0-9_]+$/.test(invoice.id),
    )
  )
    throw new Error("Invalid provider invoice page buyer scope");
  const last = response.data[response.data.length - 1]?.id;
  if (response.has_more && (!last || last === after))
    throw new Error("Provider invoice page has no advancing continuation");
  return {
    page: response.data,
    hasMore: response.has_more,
    continueCursor: response.has_more ? encodeCursor(scope, last!) : null,
  };
}
