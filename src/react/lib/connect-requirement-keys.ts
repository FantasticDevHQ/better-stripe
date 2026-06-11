/**
 * Maps Stripe Connect requirement field names to human-readable i18n keys.
 * Apps can use these keys to look up translations in their i18n system.
 */

const REQUIREMENT_KEY_MAP: Record<string, string> = {
  "business_profile.url": "stripe.requirements.businessUrl",
  "business_profile.mcc": "stripe.requirements.businessCategory",
  "business_profile.product_description":
    "stripe.requirements.productDescription",
  external_account: "stripe.requirements.bankAccount",
  "individual.first_name": "stripe.requirements.firstName",
  "individual.last_name": "stripe.requirements.lastName",
  "individual.dob.day": "stripe.requirements.dateOfBirth",
  "individual.dob.month": "stripe.requirements.dateOfBirth",
  "individual.dob.year": "stripe.requirements.dateOfBirth",
  "individual.address.line1": "stripe.requirements.address",
  "individual.address.city": "stripe.requirements.city",
  "individual.address.state": "stripe.requirements.state",
  "individual.address.postal_code": "stripe.requirements.postalCode",
  "individual.address.country": "stripe.requirements.country",
  "individual.email": "stripe.requirements.email",
  "individual.phone": "stripe.requirements.phone",
  "individual.ssn_last_4": "stripe.requirements.ssnLast4",
  "individual.id_number": "stripe.requirements.idNumber",
  "individual.verification.document": "stripe.requirements.identityDocument",
  "tos_acceptance.date": "stripe.requirements.tosAcceptance",
  "tos_acceptance.ip": "stripe.requirements.tosAcceptance",
  "company.name": "stripe.requirements.companyName",
  "company.tax_id": "stripe.requirements.taxId",
};

/**
 * Get the i18n key for a Stripe requirement field.
 * Returns the field name as fallback if no mapping exists.
 */
export function getRequirementKey(field: string): string {
  return (
    REQUIREMENT_KEY_MAP[field] ??
    `stripe.requirements.${field.replace(/\./g, "_")}`
  );
}

/**
 * Get a default English label for a Stripe requirement field.
 */
export function getRequirementLabel(
  field: string,
  overrides?: Record<string, string>,
): string {
  if (overrides?.[field]) return overrides[field];

  const defaults: Record<string, string> = {
    "business_profile.url": "Business website",
    "business_profile.mcc": "Business category",
    "business_profile.product_description": "Product description",
    external_account: "Bank account",
    "individual.first_name": "First name",
    "individual.last_name": "Last name",
    "individual.email": "Email address",
    "individual.phone": "Phone number",
    "tos_acceptance.date": "Terms of service",
  };

  return defaults[field] ?? field.split(".").pop()?.replace(/_/g, " ") ?? field;
}
