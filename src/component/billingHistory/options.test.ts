import { expect, it } from "vitest";
import { historyOptions } from "./scope.js";
const scope = { kind: "subscriptions" as const, userId: "original" };
it("preserves stricter caller read ceilings rather than increasing the read budget", () => {
  expect(
    historyOptions(scope, {
      cursor: null,
      numItems: 10,
      maximumRowsRead: 1,
      maximumBytesRead: 256,
    }),
  ).toMatchObject({ maximumRowsRead: 1, maximumBytesRead: 256 });
});
it("rejects empty pinned cursors rather than forwarding a raw native cursor", () => {
  expect(() =>
    historyOptions(scope, { cursor: null, endCursor: "", numItems: 10 }),
  ).toThrow();
});
it.each([0, -1, 1.5, Infinity])(
  "rejects invalid caller read ceiling %s",
  (maximumRowsRead) => {
    expect(() =>
      historyOptions(scope, { cursor: null, numItems: 10, maximumRowsRead }),
    ).toThrow();
  },
);

it.each([" original", "original ", "original\nline", "original\u007f"])(
  "rejects noncanonical original selector %j",
  (userId) => {
    expect(() =>
      historyOptions({ ...scope, userId }, { cursor: null, numItems: 10 }),
    ).toThrow();
  },
);
