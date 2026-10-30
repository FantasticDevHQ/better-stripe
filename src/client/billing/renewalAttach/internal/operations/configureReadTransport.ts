import { types } from "node:util";
import { OWNER } from "../originalOwner.js";
import { closed, need, stop, type SourceMethod } from "./types.js";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import { resourceId } from "../../../renewalAggregate/shared.js";
import { loadConfigureOwnedReadTransportSource } from "./sourceOperations.js";

const API = "2026-09-30.endive";
type Resource = "subscription" | "price" | "customer" | "coupon" | "schedule";
type Row = Readonly<{
  resource: Resource;
  ordinal: number;
  method: "GET";
  path: string;
  body: undefined;
  id: string;
  options: Readonly<{ apiVersion: typeof API; maxNetworkRetries: 0 }>;
}>;
const query =
  "?" +
  new URLSearchParams(
    ["discounts", "items.data.discounts", "items.data.price"].map(
      (value, index) => ["expand[" + index + "]", value],
    ),
  );
const plural = Object.freeze({
  subscription: "subscriptions",
  price: "prices",
  customer: "customers",
  coupon: "coupons",
  schedule: "subscription_schedules",
});
const prefix = Object.freeze({
  subscription: "sub",
  price: "price",
  customer: "cus",
  schedule: "sub_sched",
});

function selectedID(resource: Resource, path: string): string {
  const root = "/v1/" + plural[resource] + "/";
  need(path.startsWith(root));
  const encoded = path.slice(
    root.length,
    resource === "subscription" ? -query.length : undefined,
  );
  if (resource === "subscription") need(path.endsWith(query));
  if (resource !== "coupon") {
    const parsed = resourceId(prefix[resource]).safeParse(encoded);
    need(parsed.success);
    const id = parsed.data;
    need(encodeURIComponent(id) === encoded);
    return id;
  }
  let id: string;
  try {
    id = decodeURIComponent(encoded);
  } catch {
    return stop();
  }
  need(
    id.length >= 1 &&
      id.length <= 255 &&
      /\S/.test(id) &&
      id !== "." &&
      id !== ".." &&
      encodeURIComponent(id) === encoded,
  );
  return id;
}

/** Fixed DATA profile only. Undefined bodies remain explicit, never JSON-compared. */
function capturePlan(raw: unknown): readonly Row[] {
  need(!types.isProxy(raw) && Array.isArray(raw));
  need(Object.getPrototypeOf(raw) === Array.prototype);
  const length = Object.getOwnPropertyDescriptor(raw, "length"),
    count: unknown = length?.value;
  need(
    length &&
      "value" in length &&
      typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 4 &&
      count <= 44,
  );
  const keys = Reflect.ownKeys(raw);
  need(
    keys.length === count + 1 && keys.every((key) => typeof key === "string"),
  );
  const rows: Row[] = [],
    coupons = new Set<string>();
  for (let index = 0; index < count; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    need(descriptor && descriptor.enumerable && "value" in descriptor);
    const row = closed(descriptor.value, [
        "resource",
        "ordinal",
        "method",
        "path",
        "body",
        "options",
      ]),
      options = closed(row.options, ["apiVersion", "maxNetworkRetries"]);
    const resource: Resource =
      index === 0
        ? "subscription"
        : index === 1
          ? "price"
          : index === 2
            ? "customer"
            : index === count - 1
              ? "schedule"
              : "coupon";
    need(
      row.resource === resource &&
        row.ordinal === index + 1 &&
        row.method === "GET" &&
        typeof row.path === "string" &&
        row.body === undefined &&
        options.apiVersion === API &&
        options.maxNetworkRetries === 0,
    );
    const id = selectedID(resource, row.path);
    requiredJSONSnapshot(row.path);
    if (resource === "coupon") {
      need(!coupons.has(id));
      coupons.add(id);
    }
    rows.push(
      Object.freeze({
        resource,
        ordinal: index + 1,
        method: "GET",
        path: row.path,
        body: undefined,
        id,
        options: Object.freeze({ apiVersion: API, maxNetworkRetries: 0 }),
      }),
    );
  }
  need(coupons.size <= 40);
  return Object.freeze(rows);
}

function sourceMethod(delegate: unknown): SourceMethod {
  need(
    delegate !== null &&
      typeof delegate === "object" &&
      !types.isProxy(delegate),
  );
  const value = closed(delegate, ["rawRequest"]).rawRequest;
  need(typeof value === "function" && !types.isProxy(value));
  return value as SourceMethod;
}

/** Separate fixed readonly operation pair. No POST or caller binding factory exists. */
export function createConfigureOwnedReadTransport() {
  need(arguments.length === 0);
  OWNER.check();
  const source = loadConfigureOwnedReadTransportSource();
  OWNER.check();
  const frame = closed(source, ["owner", "operation", "readPlan", "delegate"]);
  need(frame.owner === OWNER);
  const operation = frame.operation,
    delegate = frame.delegate,
    readPlanReference = frame.readPlan,
    plan = capturePlan(readPlanReference),
    method = sourceMethod(delegate),
    generation = Object.freeze({});
  let phase = "unused",
    index = 0,
    closedOwner = false,
    checking = false;
  let pending: Readonly<{ generation: object; ordinal: number }> | null = null;
  function gate() {
    if (closedOwner || checking) {
      closedOwner = true;
      stop();
    }
    checking = true;
    try {
      OWNER.check();
      if (closedOwner) stop();
    } catch {
      closedOwner = true;
      stop();
    } finally {
      checking = false;
    }
  }
  const capability = Object.freeze({
    assertSourceOperationBinding(
      actualOperation: unknown,
      expectedPlan: unknown,
      actualDelegate: unknown,
      originalMethod: unknown,
    ) {
      need(arguments.length === 4);
      gate();
      if (
        phase !== "unused" ||
        operation !== actualOperation ||
        delegate !== actualDelegate ||
        method !== originalMethod
      ) {
        phase = "invalid";
        return false;
      }
      const expected = capturePlan(expectedPlan);
      const matches =
        expected.length === plan.length &&
        expected.every((row, ordinal) => {
          const fixed = plan[ordinal];
          return (
            row.resource === fixed.resource &&
            row.ordinal === fixed.ordinal &&
            row.method === fixed.method &&
            row.path === fixed.path &&
            row.body === fixed.body &&
            row.id === fixed.id &&
            row.options.apiVersion === fixed.options.apiVersion &&
            row.options.maxNetworkRetries === fixed.options.maxNetworkRetries
          );
        });
      gate();
      phase = matches ? "bound" : "invalid";
      return matches;
    },
    reserveAcquisition() {
      need(arguments.length === 0);
      gate();
      if (phase !== "bound" || index !== 0 || pending !== null) return false;
      phase = "reserved";
      return true;
    },
  });
  const readTransport = Object.freeze({
    async rawRequest(
      methodName: "GET",
      path: string,
      body: undefined,
      options: Readonly<{ apiVersion: typeof API; maxNetworkRetries: 0 }>,
    ): Promise<unknown> {
      need(arguments.length === 4);
      gate();
      need(phase === "reserved" && pending === null && index < plan.length);
      const row = plan[index],
        actualOptions = closed(options, ["apiVersion", "maxNetworkRetries"]);
      need(
        methodName === row.method &&
          path === row.path &&
          body === row.body &&
          actualOptions.apiVersion === API &&
          actualOptions.maxNetworkRetries === 0,
      );
      const attempt = Object.freeze({ generation, ordinal: index + 1 });
      need(attempt.ordinal <= 44);
      pending = attempt;
      let reply: unknown;
      try {
        reply = await Reflect.apply(method, delegate, [
          methodName,
          path,
          body,
          row.options,
        ]);
      } catch {
        gate();
        phase = "failed";
        pending = null;
        return stop();
      }
      gate();
      need(pending === attempt && attempt.generation === generation);
      pending = null;
      index++;
      if (index === plan.length) phase = "readclosed";
      return reply;
    },
  });
  return Object.freeze({
    transport: Object.freeze({ readTransport }),
    capability,
  });
}
