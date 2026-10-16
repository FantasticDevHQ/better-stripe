import { z } from "zod";
export const observationPagination = z
  .object({
    numItems: z.number().int().min(1).max(100),
    cursor: z.string().nullable(),
    id: z.number().optional(),
    endCursor: z.string().nullable().optional(),
    maximumRowsRead: z.number().optional(),
    maximumBytesRead: z.number().optional(),
  })
  .strict();
