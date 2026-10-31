import type { Infer } from "convex/values";
import type { QueryCtx } from "../_generated/server.js";
import type { reservationData, eventDescriptor } from "./schema.js";

export type JournalReader = Pick<QueryCtx, "db">;
export type Reservation = Infer<typeof reservationData>;
export type CheckedEvents = readonly (Infer<typeof eventDescriptor> & {
  dataJSON: string;
})[];
