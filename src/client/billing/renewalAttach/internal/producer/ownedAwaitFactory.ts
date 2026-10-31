import { ownerForInitialLineage } from "./ownerFactory.js";

/** Each continuation retains its own canonical Owner, with no ambient switch. */
export function ownedAwaitForInitialLineage(token: object) {
  const owner = ownerForInitialLineage(token);
  return function owned<T>(work: () => T | PromiseLike<T>): Promise<T> {
    owner.check();
    return new Promise((resolve, reject) => {
      let settled = false;
      let remove: (() => void) | null = null;
      function finish(ok: boolean, value: unknown) {
        if (settled) return;
        settled = true;
        remove?.();
        if (ok) resolve(value as T);
        else reject(value);
      }
      const retire = () => finish(false, Error("INITIAL_OWNER_STOP"));
      remove = owner.subscribe(retire);
      if (settled) {
        remove();
        return;
      }
      let pending: T | PromiseLike<T>;
      try {
        owner.check();
        pending = work();
      } catch (error) {
        finish(false, error);
        return;
      }
      void Promise.resolve(pending).then(
        (value) => {
          if (settled) return;
          try {
            owner.check();
            finish(true, value);
          } catch {
            retire();
          }
        },
        (error: unknown) => {
          if (settled) return;
          try {
            owner.check();
            finish(false, error);
          } catch {
            retire();
          }
        },
      );
    });
  };
}
