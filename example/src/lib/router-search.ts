/** Preserve the example's flat, string-valued public URLs, including repeated keys. */
export function parseSearch(search: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of new URLSearchParams(search)) {
    const previous = result[key];
    result[key] =
      previous === undefined
        ? value
        : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  return result;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string") params.append(key, item);
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function text(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : undefined;
}
function choice<const T extends string>(
  value: unknown,
  choices: readonly T[],
): T | undefined {
  const candidate = text(value);
  return choices.find((option) => option === candidate);
}

/** Invalid selectors are absent so each view keeps its existing default/fallback. */
export type ExampleSearch = Partial<{
  example: "headless" | "components" | "embedded" | "hosted";
  checkout: "embedded" | "form" | "redirect" | "custom" | "payment-intent";
  section: "details" | "setup" | "stripe-settings";
  diagnostics: "protocol";
}> &
  Partial<
    Record<
      | "priceId"
      | "ref"
      | "store"
      | "product"
      | "offer"
      | "session_id"
      | "purchase_session_id"
      | "payment_intent"
      | "payment_intent_client_secret"
      | "redirect_status"
      | "charge_id",
      string
    >
  >;

export function validateSearch(input: Record<string, unknown>): ExampleSearch {
  return {
    ...parseSearch(stringifySearch(input)),
    example: choice(input.example, [
      "headless",
      "components",
      "embedded",
      "hosted",
    ]),
    checkout: choice(input.checkout, [
      "embedded",
      "form",
      "redirect",
      "custom",
      "payment-intent",
    ]),
    section: choice(input.section, ["details", "setup", "stripe-settings"]),
    diagnostics: choice(input.diagnostics, ["protocol"]),
    priceId: text(input.priceId),
    ref: text(input.ref),
    store: text(input.store),
    product: text(input.product),
    offer: text(input.offer),
    session_id: text(input.session_id),
    purchase_session_id: text(input.purchase_session_id),
    payment_intent: text(input.payment_intent),
    payment_intent_client_secret: text(input.payment_intent_client_secret),
    redirect_status: text(input.redirect_status),
    charge_id: text(input.charge_id),
  };
}
