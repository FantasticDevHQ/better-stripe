import { z } from "zod";

import { assertPersonalAccountUserId } from "../../component/core/personalAccountMapping.js";
import type { PersonalAccountMapping } from "../../component/core/personalAccountMapping.js";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";

export type { PersonalAccountMapping } from "../../component/core/personalAccountMapping.js";
const optionsSchema = z.object({ userId: z.string() }).strict();

/** Mapping evidence only. Authenticate the host actor before passing its server-owned identity. */
export async function getPersonalAccountMapping(
  component: Component,
  ctx: RunCtx,
  input: { userId: string },
): Promise<PersonalAccountMapping> {
  const opts = optionsSchema.parse(input);
  assertPersonalAccountUserId(opts.userId);
  return ctx.runQuery(
    componentRef(component, "core/queries/getPersonalAccountMapping"),
    opts,
  );
}
