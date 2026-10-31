import { OWNER } from "../originalOwner.js";
import { ownerForInitialLineage } from "../producer/ownerFactory.js";

export interface FailureForwarder {
  forward(error: unknown): object | null;
}
/** Same original owner around each actor continuation; no new timer or origin. */
export function owned<T>(
  work: () => T | PromiseLike<T>,
  failureControl: FailureForwarder | null = null,
): Promise<T> {
  return runOwned(OWNER, work, failureControl);
}
export function ownedForInitialLineage(token: object) {
  if (arguments.length !== 1) throw Error("INITIAL_ACTOR_STOP");
  const owner = ownerForInitialLineage(token);
  return function owned<T>(
    work: () => T | PromiseLike<T>,
    control: FailureForwarder | null = null,
  ): Promise<T> {
    return runOwned(owner, work, control);
  };
}
function runOwned<T>(
  owner: Pick<typeof OWNER, "check" | "subscribe">,
  work: () => T | PromiseLike<T>,
  failureControl: FailureForwarder | null,
): Promise<T> {
  owner.check();
  return new Promise((resolve, reject) => {
    let done = false,
      remove: (() => void) | null = null;
    const finish = (ok: boolean, value: unknown) => {
      if (done) return;
      done = true;
      if (remove) remove();
      if (ok) resolve(value as T);
      else reject(value);
    };
    const retire = () => finish(false, Error("INITIAL_ACTOR_STOP"));
    remove = owner.subscribe(retire);
    if (done) {
      remove();
      return;
    }
    let pending: T | PromiseLike<T>;
    try {
      owner.check();
      pending = work();
    } catch {
      finish(false, Error("INITIAL_ACTOR_STOP"));
      return;
    }
    void Promise.resolve(pending).then(
      (value) => {
        if (done) return;
        try {
          owner.check();
          finish(true, value);
        } catch {
          retire();
        }
      },
      (error: unknown) => {
        if (done) return;
        try {
          owner.check();
          const forwarded = failureControl
            ? failureControl.forward(error)
            : null;
          finish(
            false,
            forwarded === null ? Error("INITIAL_ACTOR_STOP") : forwarded,
          );
        } catch {
          retire();
        }
      },
    );
  });
}
