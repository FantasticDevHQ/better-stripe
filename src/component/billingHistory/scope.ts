import type { PaginationOptions, PaginationResult } from "convex/server";

export type HistoryScope = {
  kind: "subscriptions" | "checkoutSessions";
  userId: string;
  accountId?: string;
  status?: string;
};

function encoded(scope: HistoryScope, cursor: string) {
  return btoa(
    encodeURIComponent(JSON.stringify({ version: 1, scope, cursor })),
  );
}

function decoded(scope: HistoryScope, cursor: string) {
  try {
    const value = JSON.parse(decodeURIComponent(atob(cursor)));
    if (
      value.version !== 1 ||
      typeof value.cursor !== "string" ||
      encoded(scope, value.cursor) !== cursor
    )
      throw new Error();
    return value.cursor as string;
  } catch {
    throw new Error("Invalid billing history cursor or scope");
  }
}

/** Context binding only; the trusted host must authorize every call. */
export function historyOptions(
  scope: HistoryScope,
  options: PaginationOptions,
) {
  if (
    !isCanonical(scope.userId) ||
    (scope.accountId !== undefined && !isCanonical(scope.accountId)) ||
    !Number.isSafeInteger(options.numItems) ||
    options.numItems < 1 ||
    options.numItems > 100
  )
    throw new Error("Invalid billing history selector or page size");
  return {
    ...options,
    cursor: options.cursor === null ? null : decoded(scope, options.cursor),
    ...(options.endCursor !== undefined && options.endCursor !== null
      ? { endCursor: decoded(scope, options.endCursor) }
      : {}),
    maximumRowsRead: ceiling(options.maximumRowsRead, 200),
    maximumBytesRead: ceiling(options.maximumBytesRead, 1_000_000),
  };
}

export function historyResult<T>(
  scope: HistoryScope,
  result: PaginationResult<T>,
) {
  return {
    ...result,
    continueCursor: encoded(scope, result.continueCursor),
    ...(result.splitCursor
      ? { splitCursor: encoded(scope, result.splitCursor) }
      : {}),
  };
}

function ceiling(requested: number | undefined, policy: number) {
  if (requested === undefined) return policy;
  if (!Number.isSafeInteger(requested) || requested < 1)
    throw new Error("Invalid billing history read ceiling");
  return Math.min(requested, policy);
}

function isCanonical(value: string) {
  return value.length > 0 && value === value.trim() && !/\p{Cc}/u.test(value);
}
