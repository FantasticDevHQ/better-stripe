import { readOriginalConfigureAttempt } from "./configureAttemptAuthority.js";
import { need } from "../configure/request.js";
/** Actual returned initial/recovered output identity, never a receipt registration API. */
export function readAdmittedConfigureAcknowledgement(token: object) {
  need(arguments.length === 1);
  const attempt = readOriginalConfigureAttempt(token),
    completed = attempt.completion;
  need(completed);
  completed.guard();
  return completed.view;
}
