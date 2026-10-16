import schema from "./convex/schema";
export { schema };
export const modules = import.meta.glob("./convex/**/*.ts");
