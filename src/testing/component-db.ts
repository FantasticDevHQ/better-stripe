/** Model the deployed component boundary that convex-test does not enforce. */
export function componentDb<T extends object>(db: T): T {
  function wrap<TValue extends object>(value: TValue): TValue {
    return new Proxy(value, {
      get(target, key) {
        if (key === "paginate")
          return () => {
            throw new Error("paginate() is only supported in the app");
          };
        const member = Reflect.get(target, key);
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          const result = member.apply(target, args);
          return result &&
            typeof result === "object" &&
            !(result instanceof Promise)
            ? wrap(result)
            : result;
        };
      },
    });
  }
  return wrap(db);
}
