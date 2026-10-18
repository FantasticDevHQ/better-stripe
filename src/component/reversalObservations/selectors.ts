import { canonicalFingerprint } from "../operationEvidence/canonical.js";
export const bucketDigest = (bucketKey: string) =>
  canonicalFingerprint({ domain: "reversal-bucket-v1", bucketKey });
export const ownerDigest = (userId: string, orgId?: string) =>
  canonicalFingerprint({
    domain: "reversal-owner-v1",
    userId,
    ...(orgId === undefined ? {} : { orgId }),
  });
