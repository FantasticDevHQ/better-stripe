// Internal tracker references that must not reach published documentation.
// Shared by the release changelog formatter and the shipped-docs guard so the
// two cannot drift: an ID prefix the guard rejects is one the formatter strips.
export const internalIssuePrefixes = Object.freeze([
  "BTS",
  "CNW",
  "DOJO",
  "FANT",
  "FORG",
  "FTD",
  "LCH",
]);

const prefixes = internalIssuePrefixes.join("|");

/** Source for an internal issue ID such as `ABC-123` (prefix list above). */
export const internalIssueIdSource = `(?:${prefixes})-\\d+`;

/** Matches an issue ID, a bare `BTS` team key, or a tracker link. */
export const internalReferencePattern = new RegExp(
  `\\b(?:${internalIssueIdSource}|BTS)\\b|https?:\\/\\/(?:www\\.)?linear\\.app\\/`,
  "i",
);
