import type { CapturedNode } from "./eventCodec.js";
import type {
  ConstructRenewalScheduleAttachmentReceiptV2Options,
  ProjectRenewalConfigurationV2Options,
} from "../../../renewalV2/index.js";
type Stage = "attach" | "configure";
type EventKind = "dispatch" | "response" | "receipt";
type Schema = { required: string[]; optional: string[] };
// Six fixed mixed event captures. Pending derived slots remain unverified until full own reconstruction.
import { requiredJSONSnapshot } from "./privacy.js";
import { objectNode, scalarNode, materialize } from "./eventCodec.js";
import { need, stop, field, scalar, freeze, closed } from "./ownData.js";
const attachKeys = [
  "version",
  "stage",
  "scope",
  "apiVersion",
  "logicalBinding",
  "method",
  "path",
  "payload",
  "key",
  "firstDispatchedAt",
  "requestIdentity",
];
const configureKeys = [
  "version",
  "stage",
  "scope",
  "apiVersion",
  "logicalBinding",
  "scheduleId",
  "method",
  "path",
  "key",
  "payload",
  "firstDispatchedAt",
  "attachReceiptBinding",
  "baselineBinding",
  "defaultSettingsBinding",
  "status",
  "providerQualification",
  "profile",
  "requestIdentity",
];
const attachedKeys = [
  "version",
  "stage",
  "scope",
  "logicalBinding",
  "request",
  "scheduleId",
  "subscriptionId",
  "customerAccountId",
  "livemode",
  "providerSnapshot",
  "binding",
];
const storedKeys = [
  "version",
  "stage",
  "scope",
  "verification",
  "apiVersion",
  "logicalBinding",
  "request",
  "attachReceiptBinding",
  "scheduleId",
  "subscriptionId",
  "customerAccountId",
  "billingCustomerId",
  "livemode",
  "providerSnapshot",
  "transport",
  "providerSnapshotBinding",
  "binding",
];
const pendingRequest = (prefix: string, stage: Stage): [string, string][] =>
  stage === "attach"
    ? [
        [prefix + "/logicalBinding", "renewal"],
        [prefix + "/requestIdentity/binding", "renewal-attach"],
      ]
    : [
        [prefix + "/logicalBinding", "renewal"],
        [prefix + "/attachReceiptBinding", "renewal-attach-receipt"],
        [prefix + "/baselineBinding", "renewal-baseline"],
        [prefix + "/defaultSettingsBinding", "renewal-defaults"],
        [prefix + "/requestIdentity/binding", "renewal-configure"],
      ];
function fixed(stage: Stage, kind: EventKind) {
  const schemas = new Map<string, Schema>(),
    pending = new Map(pendingRequest("request", stage));
  const set = (p: string, required: string[], optional: string[] = []) =>
    schemas.set(p, { required, optional });
  set(
    "",
    kind === "dispatch"
      ? ["event", "stage", "request"]
      : kind === "response"
        ? [
            "event",
            "stage",
            "request",
            "body",
            stage === "attach" ? "status" : "transport",
          ]
        : ["event", "stage", "request", "receipt"],
  );
  function request(p: string) {
    set(p, stage === "attach" ? attachKeys : configureKeys);
    set(p + "/requestIdentity", ["key", "binding"]);
    set(
      p + "/payload",
      stage === "attach"
        ? ["from_subscription"]
        : ["end_behavior", "proration_behavior", "phases"],
    );
    if (stage === "configure")
      set(p + "/profile", ["apiVersion", "billingMode", "cadence", "anchor"]);
  }
  request("request");
  if (kind === "response" && stage === "configure")
    set("transport", ["status"], ["requestId"]);
  if (kind === "receipt") {
    set(
      "receipt",
      stage === "attach" ? attachedKeys : storedKeys,
      stage === "attach" ? [] : ["defaultSettingsBinding"],
    );
    request("receipt/request");
    for (const [p, f] of pendingRequest("receipt/request", stage))
      pending.set(p, f);
    pending.set("receipt/logicalBinding", "renewal");
    pending.set(
      "receipt/binding",
      stage === "attach"
        ? "renewal-attach-receipt"
        : "renewal-configure-receipt",
    );
    if (stage === "configure") {
      set("receipt/transport", ["status"], ["requestId"]);
      pending.set("receipt/attachReceiptBinding", "renewal-attach-receipt");
      pending.set(
        "receipt/providerSnapshotBinding",
        "renewal-configured-baseline",
      );
      pending.set(
        "receipt/defaultSettingsBinding",
        "renewal-configured-defaults",
      );
    }
  }
  return { schemas, pending };
}
const pathKey = (parts: string[]) =>
  parts.map((k) => k.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
function stringSize(text: string) {
  let bytes = 2,
    characters = 2;
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n === 34 || n === 92 || [8, 9, 10, 12, 13].includes(n)) {
      bytes += 2;
      characters += 2;
    } else if (n < 32) {
      bytes += 6;
      characters += 6;
    } else if (
      n >= 0xd800 &&
      n <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      characters += 2;
      i++;
    } else if (n >= 0xd800 && n <= 0xdfff) {
      bytes += 6;
      characters += 6;
    } else {
      bytes += n < 128 ? 1 : n < 2048 ? 2 : 3;
      characters++;
    }
  }
  return { bytes, characters };
}

function captureTree(
  raw: unknown,
  schemas: Map<string, Schema>,
  pending: Map<string, string>,
): CapturedNode {
  let nodes = 0,
    rawChars = 0,
    chars = 0,
    bytes = 0;
  const active = new Set<object>();
  const charge = (c: number, b: number) => {
    chars += c;
    bytes += b;
    need(chars <= 500000 && bytes <= 500000 && rawChars <= 500000);
  };
  const string = (s: string, derived: string | undefined) => {
    need(s.length <= 500000);
    if (derived)
      need(new RegExp("^" + derived + ":v2:sha256:[a-f0-9]{64}$").test(s));
    else requiredJSONSnapshot(s);
    rawChars += s.length;
    const n = stringSize(s);
    charge(n.characters, n.bytes);
  };
  function shape(keys: string[], spec: Schema | undefined) {
    if (spec)
      need(
        spec.required.every((k) => keys.includes(k)) &&
          keys.every(
            (k) => spec.required.includes(k) || spec.optional.includes(k),
          ),
      );
  }
  function walk(v: unknown, path: string[], depth: number): CapturedNode {
    need(++nodes <= 10000 && depth <= 40);
    const p = pathKey(path),
      spec = schemas.get(p);
    if (typeof v === "string") {
      need(!spec);
      string(v, pending.get(p));
      return scalarNode(v);
    }
    if (v === null || typeof v === "number" || typeof v === "boolean") {
      need(!spec && !pending.has(p));
      requiredJSONSnapshot(v);
      const n = String(v).length;
      charge(n, n);
      return scalarNode(v);
    }
    need(v && typeof v === "object" && !active.has(v));
    const array = Array.isArray(v),
      proto = Object.getPrototypeOf(v);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    need(!spec || !array);
    const keys = Reflect.ownKeys(v);
    need(keys.length <= 10001 && keys.every((k) => typeof k === "string"));
    const length = array ? Object.getOwnPropertyDescriptor(v, "length") : null;
    if (array)
      need(
        length &&
          Object.prototype.hasOwnProperty.call(length, "value") &&
          Number.isSafeInteger(length!.value) &&
          length!.value >= 0 &&
          length!.value <= 10000,
      );
    const actual = (keys as string[]).filter((k) => !(array && k === "length"));
    shape(actual, spec);
    const entries: [string, CapturedNode][] = [];
    active.add(v);
    for (const k of actual) {
      if (array) need(/^(0|[1-9][0-9]*)$/.test(k) && Number(k) < length!.value);
      const desc = Object.getOwnPropertyDescriptor(v, k);
      need(
        desc &&
          desc.enumerable &&
          Object.prototype.hasOwnProperty.call(desc, "value"),
      );
      const child = desc.value;
      // Only name+safe null/boolean is checked here: no secret value/getter is copied or read again.
      requiredJSONSnapshot(
        Object.fromEntries([[k, child === null ? null : true]]),
      );
      rawChars += k.length;
      if (!array) {
        const z = stringSize(k);
        charge(z.characters, z.bytes);
      } else charge(0, 0);
      entries.push([k, walk(child, [...path, k], depth + 1)]);
    }
    active.delete(v);
    if (array) {
      need(entries.length === length!.value);
      entries.sort(([a], [b]) => Number(a) - Number(b));
    }
    shape(
      entries.map(([k]) => k),
      spec,
    );
    const framing =
      2 + Math.max(0, entries.length - 1) + (array ? 0 : entries.length);
    charge(framing, framing);
    return array
      ? Object.freeze({
          kind: "array",
          entries: Object.freeze(entries.map((x) => Object.freeze(x))),
        })
      : objectNode(entries);
  }
  return walk(raw, [], 0);
}
function capture(raw: unknown, stage: Stage, kind: EventKind): CapturedNode {
  try {
    const { schemas, pending } = fixed(stage, kind),
      root = captureTree(raw, schemas, pending);
    need(
      scalar(field(root, "event")) === kind &&
        scalar(field(root, "stage")) === stage,
    );
    for (const p of kind === "receipt"
      ? ["request", "receipt/request"]
      : ["request"]) {
      const r = p.split("/").reduce((n, k) => field(n, k), root);
      need(
        scalar(field(r, "version")) === 2 &&
          scalar(field(r, "stage")) ===
            (stage === "attach" ? "attach" : "configure"),
      );
      need(
        scalar(field(field(r, "requestIdentity"), "key")) ===
          scalar(field(r, "key")),
      );
    }
    if (kind === "response") {
      const transport = stage === "attach" ? root : field(root, "transport"),
        status = scalar(field(transport, "status"));
      need(
        typeof status === "number" &&
          Number.isInteger(status) &&
          status >= 200 &&
          status <= 299,
      );
      const id =
        stage === "configure"
          ? (
              transport as Extract<CapturedNode, { kind: "object" | "array" }>
            ).entries.find(([k]) => k === "requestId")
          : null;
      if (id) {
        const value = scalar(id[1]);
        need(
          typeof value === "string" && value.length >= 1 && value.length <= 255,
        );
      }
    }
    if (kind === "receipt") {
      const r = field(root, "receipt");
      need(
        scalar(field(r, "version")) === 2 &&
          scalar(field(r, "stage")) ===
            (stage === "attach"
              ? "attached_unconfigured"
              : "configure_acknowledged"),
      );
    }
    return root;
  } catch {
    stop();
  }
}
export const captureAttachDispatch = (raw: unknown) =>
  capture(raw, "attach", "dispatch");
export const captureAttachResponse = (raw: unknown) =>
  capture(raw, "attach", "response");
export const captureAttachReceipt = (raw: unknown) =>
  capture(raw, "attach", "receipt");
export const captureConfigureDispatch = (raw: unknown) =>
  capture(raw, "configure", "dispatch");
export const captureConfigureResponse = (raw: unknown) =>
  capture(raw, "configure", "response");
export const captureConfigureReceipt = (raw: unknown) =>
  capture(raw, "configure", "receipt");

// Fixed ordinary constructor roots, not mixed claims or caller-selected capture contexts.
function rawSchemas(stage: Stage) {
  const schemas = new Map<string, Schema>(),
    set = (p: string, r: string[], o: string[] = []) =>
      schemas.set(p, { required: r, optional: o });
  const preparation = (p: string) =>
    set(
      p,
      ["subscription", "targetPrice", "expected", "key"],
      ["billingCustomer"],
    );
  const request = (p: string) => {
    set(p, ["preparation", "apiVersion", "attachKey", "firstDispatchedAt"]);
    preparation(p ? p + "/preparation" : "preparation");
  };
  if (stage === "attach") request("");
  else {
    set(
      "",
      [
        "preparation",
        "attachReceipt",
        "freshSubscription",
        "targetPrice",
        "schedule",
        "apiVersion",
        "observedAt",
        "firstDispatchedAt",
        "configureKey",
      ],
      ["billingCustomer"],
    );
    preparation("preparation");
    set("attachReceipt", [
      "attachRequest",
      "actualDispatch",
      "providerSnapshot",
    ]);
    request("attachReceipt/attachRequest");
    set("attachReceipt/actualDispatch", [
      "scope",
      "apiVersion",
      "method",
      "path",
      "payload",
      "key",
      "firstDispatchedAt",
    ]);
    set("attachReceipt/actualDispatch/payload", ["from_subscription"]);
  }
  return schemas;
}
function precheckSource(raw: unknown, schemas: Map<string, Schema>) {
  const visit = (value: unknown, path: string): void => {
    const spec = schemas.get(path);
    need(spec);
    const own = closed(value, spec.required, spec.optional);
    for (const key of Object.keys(own)) {
      const child = path ? path + "/" + key : key;
      if (schemas.has(child)) visit(own[key], child);
    }
  };
  visit(raw, "");
}
function source(raw: unknown, stage: Stage): unknown {
  try {
    const schemas = rawSchemas(stage);
    // 1. Names-first own-data precheck only: no full data clone/serialization/cost.
    precheckSource(raw, schemas);
    // 2. ORIGINAL full ordinary privacy/bounds admission FIRST. Discard reflection-ordered copy.
    requiredJSONSnapshot(raw);
    // 3. Recheck original descriptors with identical scalar/key privacy + WHOLE budgets;
    //    retain numeric-index array semantics. Materialize ONLY after that pass succeeds.
    const node = captureTree(raw, schemas, new Map()),
      value = materialize(node);
    // 4. Ordinary re-admission of the own stable plain graph before C1/hash/promotion.
    return freeze(requiredJSONSnapshot(value));
  } catch {
    stop();
  }
}
// The closed raw schemas are captured here; public constructors still validate every semantic field.
export const captureAttachSource = (raw: unknown) =>
  source(
    raw,
    "attach",
  ) as ConstructRenewalScheduleAttachmentReceiptV2Options["attachRequest"];
export const captureConfigureSource = (raw: unknown) =>
  source(raw, "configure") as ProjectRenewalConfigurationV2Options;
