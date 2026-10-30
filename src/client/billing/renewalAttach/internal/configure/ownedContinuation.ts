import { OWNER } from "../originalOwner.js";

/** Same original Owner subscription, with FIRST continuation guards on both outcomes. */
export function owned<T>(work: () => T | PromiseLike<T>): Promise<T> {
  OWNER.check();
  return new Promise((resolve, reject) => {
    let done = false,
      remove: (() => void) | null = null;
    const finish = (ok: boolean, value: unknown) => {
      if (done) return;
      done = true;
      remove?.();
      if (ok) resolve(value as T);
      else reject(value);
    };
    const retire = () => finish(false, Error("CONFIGURE_WRITE_STOP"));
    remove = OWNER.subscribe(retire);
    if (done) {
      remove();
      return;
    }
    let pending: T | PromiseLike<T>;
    try {
      OWNER.check();
      pending = work();
    } catch (error) {
      try {
        OWNER.check();
        finish(false, error);
      } catch {
        retire();
      }
      return;
    }
    void Promise.resolve(pending).then(
      (value) => {
        if (done) return;
        try {
          OWNER.check();
          finish(true, value);
        } catch {
          retire();
        }
      },
      (error) => {
        if (done) return;
        try {
          OWNER.check();
          finish(false, error);
        } catch {
          retire();
        }
      },
    );
  });
}
