import { z } from "zod";

const identitySchema = z
  .object({ key: z.string().min(1), binding: z.string().min(1) })
  .strict();
type Identity = z.infer<typeof identitySchema>;
const recordSchema = z
  .object({
    key: z.string().min(1),
    selection: z.string(),
    createdAt: z.number().finite().positive(),
    claim: z.string(),
    identity: identitySchema.optional(),
  })
  .strict();

/** Per-tab demo storage. Production hosts need durable, authenticated ownership. */
export async function openRetainedPortal(options: {
  storage: Pick<Storage, "getItem" | "setItem">;
  namespace: string;
  selection: string;
  prepare: (key: string) => Promise<Identity>;
  create: (identity: Identity) => Promise<string>;
  isCurrent: () => boolean;
}): Promise<string> {
  const { storage, namespace, selection, prepare, create, isCurrent } = options;
  const changed = () =>
    new Error(
      "The billing request changed. Review it and explicitly start a new request.",
    );
  if (!isCurrent()) throw changed();
  const saved = storage.getItem(namespace);
  const record =
    saved === null
      ? {
          key: `portal:${crypto.randomUUID()}`,
          selection,
          createdAt: Date.now(),
          claim: "",
        }
      : recordSchema.parse(JSON.parse(saved));
  const age = Date.now() - record.createdAt;
  // Conservative demo policy, not a promise about provider retention or URL lifetime.
  if (
    record.selection !== selection ||
    age < 0 ||
    age >= 23 * 60 * 60 * 1000 ||
    (record.identity && record.identity.key !== record.key)
  )
    throw changed();
  record.claim = crypto.randomUUID();
  function persist() {
    const value = JSON.stringify(record);
    storage.setItem(namespace, value);
    if (storage.getItem(namespace) !== value)
      throw new Error("Billing request storage is unavailable.");
  }
  function current() {
    if (
      !isCurrent() ||
      recordSchema.parse(JSON.parse(storage.getItem(namespace) ?? "null"))
        .claim !== record.claim
    )
      throw changed();
  }
  // Save the key even if read-only preparation fails or its response is lost.
  persist();
  if (!record.identity) {
    const identity = identitySchema.parse(await prepare(record.key));
    current();
    if (identity.key !== record.key) throw changed();
    record.identity = identity;
    persist();
  }
  current();
  return create(record.identity);
}
