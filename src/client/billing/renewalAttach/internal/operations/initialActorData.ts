import { types } from "node:util";
import type { AttachRequest, SourceMethod } from "./types.js";

export function sourceMethod(object: unknown, name: string): SourceMethod {
  need(object !== null && typeof object === "object" && !types.isProxy(object));
  const d = Object.getOwnPropertyDescriptor(object, name);
  need(
    d &&
      d.enumerable &&
      "value" in d &&
      typeof d.value === "function" &&
      !types.isProxy(d.value),
  );
  return d.value as SourceMethod;
}
export const stop = (): never => {
  throw Error("INITIAL_ACTOR_STOP");
};
export function need(value: unknown): asserts value {
  if (!value) stop();
}
export function seven(request: AttachRequest) {
  const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
    request;
  return Object.freeze({
    scope,
    apiVersion,
    method,
    path,
    payload,
    key,
    firstDispatchedAt,
  });
}

export const refuse = (reason: string) =>
  Object.freeze({
    status: "not_dispatched",
    reason,
    operationalAuthority: false,
  });
