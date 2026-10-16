import { query } from "../../_generated/server";

import { readState, stateValidator, target } from "../helpers";

export const get = query({
  args: target,
  returns: stateValidator,
  handler: readState,
});
