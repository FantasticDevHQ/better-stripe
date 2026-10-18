export class UsageSubscriptionError extends Error {
  constructor(
    public readonly code:
      | "unsupported_scope"
      | "overlapping_enrollment"
      | "incompatible_terms"
      | "unknown_create_outcome"
      | "provider_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "UsageSubscriptionError";
  }
}
